import { useEffect, useRef } from 'react'
import { createEngineApi } from '../../gl/engineApi'
import { Renderer } from '../../gl/renderer'
import { scanOutputDims } from '../../gl/scan'
import { buildModelMatrix, clampPan, composeFlip, DEFAULT_VIEW, toggleFit, zoomAboutCursor, zoomTo } from '../../gl/viewTransform'
import type { ViewState } from '../../gl/viewTransform'
import { WebGpuRenderer } from '../../gl/webgpu/webgpuRenderer'
import { getDisplayLut } from '../../ipc/display'
import { onDecodeFailed, onLevelReady } from '../../ipc/events'
import { fetchPixels } from '../../ipc/pixels'
import { isEditableTarget, KEYMAP } from '../../shortcuts/keymap'
import { useEditStore } from '../../store/editStore'
import { useHistogram } from '../../store/histogramStore'
import { LEVEL_RANK, neighbors, usePlaylist, WINDOW_RADIUS } from '../../store/playlist'
import { useSamplerPins } from '../../store/samplerPins'
import { useSettings } from '../../store/settings'
import { useUiStore } from '../../store/uiStore'
import { onZoomCommand } from '../../store/viewportCommand'
import { useViewportProjection } from '../../store/viewportProjection'
import type { LevelReadyPayload } from '../../types/LevelReadyPayload'
import { canvasToUv } from './projection'
import { hasToneCapture, runToneCapture } from './toneHighlight'

const cursorPoint = (event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement, dpr: number) => {
    const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * dpr - canvas.width / 2, y: canvas.height / 2 - (event.clientY - rect.top) * dpr }
}

export const useRenderEngine = () => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const renderBackend = useSettings((state) => state.renderBackend)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        let initDisposed = false
        let cleanup: (() => void) | null = null

        const init = async () => {
            let renderer: Renderer | WebGpuRenderer | null = null
            if (renderBackend === 'webgpu') renderer = await WebGpuRenderer.create(canvas).catch(() => null)
            if (initDisposed) {
                renderer?.dispose()
                return
            }
            if (!renderer) {
                try {
                    renderer = new Renderer(canvas)
                } catch {
                    useUiStore.getState().setGpuError(true)
                    return
                }
            }
            cleanup = attach(renderer)
        }

        const attach = (renderer: Renderer | WebGpuRenderer) => {
            let view: ViewState = { ...DEFAULT_VIEW }
            let raf: number | null = null
            let disposed = false
            let spacePressed = false
            let drag: { x: number; y: number; panning: boolean; moved: boolean; pin: boolean } | null = null
            const fetches = new Map<string, AbortController>()

            const currentProjection = () => {
                if (useUiStore.getState().sideBySide) return null
                const metrics = renderer.getMetrics()
                const state = usePlaylist.getState()
                const current = state.entries[state.currentIndex]
                const level = current ? state.best[current.imageId] : undefined
                if (!metrics || !current || !level) return null
                const editState = useEditStore.getState().state
                const rotate90 = editState?.geometry.rotate90 ?? 0
                const dims = useUiStore.getState().scanEditMode
                    ? { w: level.width, h: level.height }
                    : scanOutputDims(level.width, level.height, editState?.scan)
                const model = buildModelMatrix(view, metrics, dims.w, dims.h, composeFlip(level.flip, rotate90))
                return { model, clientW: canvas.clientWidth, clientH: canvas.clientHeight, imageId: current.imageId }
            }

            const publishProjection = () => {
                const projection = currentProjection()
                if (projection) useViewportProjection.getState().publish(projection.model, projection.clientW, projection.clientH, projection.imageId)
                else useViewportProjection.getState().clear()
            }

            const scheduleRender = () => {
                if (raf != null) return
                raf = requestAnimationFrame(() => {
                    raf = null
                    renderer.render(view)
                    publishProjection()
                    if (hasToneCapture()) runToneCapture(canvas)
                })
            }

            const fetchAndUpload = async (payload: LevelReadyPayload) => {
                if (disposed) return
                const known = usePlaylist.getState().best[payload.imageId]
                if (known && LEVEL_RANK[known.level] > LEVEL_RANK[payload.level] && renderer.hasImage(payload.imageId)) return
                const key = `${payload.imageId}:${payload.level}`
                fetches.get(key)?.abort()
                const controller = new AbortController()
                fetches.set(key, controller)
                try {
                    const pixels = await fetchPixels(payload.imageId, payload.level, payload.rev, controller.signal)
                    if (controller.signal.aborted) return
                    if (pixels.kind === 'jpeg') {
                        const bitmap = await createImageBitmap(pixels.blob, { imageOrientation: 'none', colorSpaceConversion: 'none' })
                        if (controller.signal.aborted) {
                            bitmap.close()
                            return
                        }
                        const ok = renderer.uploadL0(
                            { imageId: payload.imageId, width: bitmap.width, height: bitmap.height, flip: payload.flip },
                            bitmap,
                        )
                        bitmap.close()
                        if (!ok) return
                    } else {
                        const ok = renderer.uploadAeth(
                            {
                                imageId: payload.imageId,
                                width: pixels.width,
                                height: pixels.height,
                                flip: payload.flip,
                                colorMatrix: payload.colorMatrix,
                            },
                            pixels.data,
                        )
                        if (!ok) return
                    }
                    usePlaylist.getState().setLevel(payload)
                    const state = usePlaylist.getState()
                    if (state.entries[state.currentIndex]?.imageId === payload.imageId) scheduleRender()
                } catch (error) {
                    if (error instanceof Error && error.name === 'AbortError') return
                } finally {
                    if (fetches.get(key) === controller) fetches.delete(key)
                }
            }

            const syncWindow = () => {
                const state = usePlaylist.getState()
                renderer.setCurrent(state.entries[state.currentIndex]?.imageId ?? null)
                const windowIds = neighbors(state.entries, state.currentIndex, WINDOW_RADIUS).windowIds
                renderer.setWindow(windowIds)
                for (const [key, controller] of fetches) {
                    const imageId = key.slice(0, key.lastIndexOf(':'))
                    if (!windowIds.includes(imageId)) {
                        controller.abort()
                        fetches.delete(key)
                    }
                }
                scheduleRender()
            }

            const api = createEngineApi(renderer, scheduleRender)
            useUiStore.getState().attachEngine(api)
            useUiStore.getState().setRenderCaps({ lowPrecision: renderer.lowPrecision, displaySpace: renderer.displaySpace })
            renderer.resize()
            syncWindow()

            renderer.setUseMonitorProfile(useSettings.getState().useMonitorProfile)
            getDisplayLut()
                .then((lut) => {
                    if (!lut || disposed) return
                    renderer.setDisplayLut(lut.size, lut.data)
                    scheduleRender()
                })
                .catch(() => undefined)
            const unsubMonitor = useSettings.subscribe((state, previous) => {
                if (state.useMonitorProfile === previous.useMonitorProfile) return
                renderer.setUseMonitorProfile(state.useMonitorProfile)
                scheduleRender()
            })

            const observer = new ResizeObserver(() => {
                renderer.resize()
                scheduleRender()
            })
            observer.observe(canvas)

            const onWheel = (event: WheelEvent) => {
                const metrics = renderer.getMetrics()
                if (!metrics) return
                event.preventDefault()
                if (event.ctrlKey || event.altKey) {
                    view = zoomAboutCursor(view, metrics, cursorPoint(event, canvas, metrics.dpr), Math.exp(-event.deltaY * 0.01))
                } else {
                    const pan = { x: view.pan.x - event.deltaX * metrics.dpr, y: view.pan.y + event.deltaY * metrics.dpr }
                    view = { ...view, pan: clampPan(pan, view, metrics) }
                }
                scheduleRender()
            }

            const onPointerDown = (event: PointerEvent) => {
                if (event.button !== 0) return
                const pin = event.shiftKey && !spacePressed
                drag = { x: event.clientX, y: event.clientY, panning: spacePressed, moved: false, pin }
                if (spacePressed || pin) canvas.setPointerCapture(event.pointerId)
            }

            const onPointerMove = (event: PointerEvent) => {
                if (!drag) return
                const dx = event.clientX - drag.x
                const dy = event.clientY - drag.y
                if (!drag.panning) {
                    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true
                    return
                }
                const metrics = renderer.getMetrics()
                if (!metrics) return
                drag.x = event.clientX
                drag.y = event.clientY
                const pan = { x: view.pan.x + dx * metrics.dpr, y: view.pan.y - dy * metrics.dpr }
                view = { ...view, pan: clampPan(pan, view, metrics) }
                scheduleRender()
            }

            const onPointerUp = (event: PointerEvent) => {
                const ended = drag
                drag = null
                if (!ended) return
                if (ended.pin) {
                    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
                    if (ended.moved) return
                    const projection = currentProjection()
                    if (!projection) return
                    const rect = canvas.getBoundingClientRect()
                    const uv = canvasToUv(
                        projection.model,
                        projection.clientW,
                        projection.clientH,
                        event.clientX - rect.left,
                        event.clientY - rect.top,
                    )
                    if (!uv) return
                    useSamplerPins.getState().add(projection.imageId, uv.u, uv.v)
                    scheduleRender()
                    return
                }
                if (ended.panning) {
                    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
                    return
                }
                if (ended.moved) return
                const metrics = renderer.getMetrics()
                if (!metrics) return
                view = toggleFit(view, metrics, cursorPoint(event, canvas, metrics.dpr))
                scheduleRender()
            }

            const onKeyDown = (event: KeyboardEvent) => {
                if (isEditableTarget(document.activeElement)) return
                if (event.code === KEYMAP.pan.modifier) {
                    spacePressed = true
                    event.preventDefault()
                    return
                }
                if (!event.metaKey && event.code === KEYMAP.zoom.toggleFit) {
                    const metrics = renderer.getMetrics()
                    if (metrics) {
                        view = toggleFit(view, metrics, { x: 0, y: 0 })
                        scheduleRender()
                    }
                    event.preventDefault()
                    return
                }
                if (event.metaKey && event.code === KEYMAP.zoom.fit) {
                    view = { fit: true, zoom: view.zoom, pan: { x: 0, y: 0 } }
                    scheduleRender()
                    event.preventDefault()
                    return
                }
                if (event.metaKey && event.code === KEYMAP.zoom.actual) {
                    view = zoomTo(1)
                    scheduleRender()
                    event.preventDefault()
                    return
                }
                if (event.metaKey && event.code === KEYMAP.zoom.double) {
                    view = zoomTo(2)
                    scheduleRender()
                    event.preventDefault()
                }
            }

            const onKeyUp = (event: KeyboardEvent) => {
                if (event.code === KEYMAP.pan.modifier) spacePressed = false
            }

            const onContextLost = (event: Event) => event.preventDefault()

            const onContextRestored = () => {
                renderer.reinit()
                const state = usePlaylist.getState()
                const current = state.entries[state.currentIndex]
                if (current) {
                    renderer.setCurrent(current.imageId)
                    renderer.setWindow(neighbors(state.entries, state.currentIndex, WINDOW_RADIUS).windowIds)
                    const best = state.best[current.imageId]
                    if (best) fetchAndUpload(best)
                }
                scheduleRender()
            }

            canvas.addEventListener('wheel', onWheel, { passive: false })
            canvas.addEventListener('pointerdown', onPointerDown)
            canvas.addEventListener('pointermove', onPointerMove)
            canvas.addEventListener('pointerup', onPointerUp)
            canvas.addEventListener('pointercancel', onPointerUp)
            canvas.addEventListener('webglcontextlost', onContextLost)
            canvas.addEventListener('webglcontextrestored', onContextRestored)
            window.addEventListener('keydown', onKeyDown)
            window.addEventListener('keyup', onKeyUp)

            const unsubZoom = onZoomCommand((command) => {
                const metrics = renderer.getMetrics()
                if (!metrics) return
                if (command === 'fit') view = { fit: true, zoom: view.zoom, pan: { x: 0, y: 0 } }
                else if (command === 'actual') view = zoomTo(1)
                else if (command === 'double') view = zoomTo(2)
                else if (command === 'toggleFit') view = toggleFit(view, metrics, { x: 0, y: 0 })
                else view = zoomTo(command.ratio)
                scheduleRender()
            })

            const unsubZoomRequest = useUiStore.subscribe((state, previous) => {
                if (!state.zoomRequest || state.zoomRequest.nonce === previous.zoomRequest?.nonce) return
                view = state.zoomRequest.preset === 'actual' ? zoomTo(1) : { fit: true, zoom: view.zoom, pan: { x: 0, y: 0 } }
                scheduleRender()
            })

            const unsubPlaylist = usePlaylist.subscribe((state, previous) => {
                if (state.currentIndex === previous.currentIndex && state.entries === previous.entries) return
                syncWindow()
            })

            const unsubHistogram = useHistogram.subscribe((state, previous) => {
                if (state.hoverRange !== previous.hoverRange) scheduleRender()
            })

            const eventUnlisteners: Array<() => void> = []
            const registerEvents = async () => {
                const level = await onLevelReady((payload) => {
                    const state = usePlaylist.getState()
                    const index = state.entries.findIndex((entry) => entry.imageId === payload.imageId)
                    if (index < 0) return
                    if (Math.abs(index - state.currentIndex) > WINDOW_RADIUS) {
                        if (payload.level === 'l0') state.setLevel(payload)
                        return
                    }
                    fetchAndUpload(payload)
                })
                const failed = await onDecodeFailed((payload) => {
                    usePlaylist.getState().setError(payload.imageId, payload.message)
                    scheduleRender()
                })
                if (disposed) {
                    level()
                    failed()
                    return
                }
                eventUnlisteners.push(level, failed)
            }
            registerEvents().catch(() => undefined)

            return () => {
                disposed = true
                observer.disconnect()
                unsubZoom()
                unsubZoomRequest()
                unsubPlaylist()
                unsubHistogram()
                unsubMonitor()
                for (const unlisten of eventUnlisteners) unlisten()
                canvas.removeEventListener('wheel', onWheel)
                canvas.removeEventListener('pointerdown', onPointerDown)
                canvas.removeEventListener('pointermove', onPointerMove)
                canvas.removeEventListener('pointerup', onPointerUp)
                canvas.removeEventListener('pointercancel', onPointerUp)
                canvas.removeEventListener('webglcontextlost', onContextLost)
                canvas.removeEventListener('webglcontextrestored', onContextRestored)
                window.removeEventListener('keydown', onKeyDown)
                window.removeEventListener('keyup', onKeyUp)
                if (raf != null) cancelAnimationFrame(raf)
                raf = null
                for (const controller of fetches.values()) controller.abort()
                fetches.clear()
                renderer.dispose()
                useUiStore.getState().setRenderCaps(null)
                useUiStore.getState().attachEngine(null)
            }
        }

        init()
        return () => {
            initDisposed = true
            cleanup?.()
        }
    }, [renderBackend])

    return { canvasRef }
}
