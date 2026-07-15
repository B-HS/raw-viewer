import { useEffect, useRef, useState } from 'react'
import { createEngineApi } from '../../gl/engineApi'
import { Renderer } from '../../gl/renderer'
import { buildModelMatrix, clampPan, DEFAULT_VIEW, toggleFit, zoomAboutCursor, zoomTo } from '../../gl/viewTransform'
import type { EngineApi } from '../../gl/engineApi'
import type { ViewState } from '../../gl/viewTransform'
import { onDecodeFailed, onLevelReady } from '../../ipc/events'
import { fetchPixels } from '../../ipc/pixels'
import { isEditableTarget, KEYMAP } from '../../shortcuts/keymap'
import { useHistogram } from '../../store/histogramStore'
import { LEVEL_RANK, neighbors, usePlaylist, WINDOW_RADIUS } from '../../store/playlist'
import { useSamplerPins } from '../../store/samplerPins'
import { useUiStore } from '../../store/uiStore'
import { onZoomCommand } from '../../store/viewportCommand'
import { useViewportProjection } from '../../store/viewportProjection'
import type { LevelReadyPayload } from '../../types/LevelReadyPayload'
import { canvasToUv } from './projection'
import { hasToneCapture, runToneCapture } from './toneHighlight'

export const shouldForceCpuRender = () => {
    try {
        return localStorage.getItem('rawviewer.forceCpuRender') === '1'
    } catch {
        return false
    }
}

const cursorPoint = (event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement, dpr: number) => {
    const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * dpr - canvas.width / 2, y: canvas.height / 2 - (event.clientY - rect.top) * dpr }
}

export const useRenderEngine = () => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const rendererRef = useRef<Renderer | null>(null)
    const viewRef = useRef<ViewState>({ ...DEFAULT_VIEW })
    const rafRef = useRef<number | null>(null)
    const fetchesRef = useRef(new Map<string, AbortController>())
    const spaceRef = useRef(false)
    const dragRef = useRef<{ x: number; y: number; panning: boolean; moved: boolean; pin: boolean } | null>(null)
    const engineRef = useRef<EngineApi | null>(null)
    const [caps, setCaps] = useState<{ lowPrecision: boolean; displaySpace: string } | null>(null)
    const [gpuError, setGpuError] = useState(shouldForceCpuRender)
    const [engine, setEngine] = useState<EngineApi | null>(null)

    const currentIndex = usePlaylist((state) => state.currentIndex)
    const entries = usePlaylist((state) => state.entries)

    const currentProjection = () => {
        const renderer = rendererRef.current
        const canvas = canvasRef.current
        if (!renderer || !canvas) return null
        if (useUiStore.getState().sideBySide) return null
        const metrics = renderer.getMetrics()
        const state = usePlaylist.getState()
        const current = state.entries[state.currentIndex]
        const level = current ? state.best[current.imageId] : undefined
        if (!metrics || !current || !level) return null
        const model = buildModelMatrix(viewRef.current, metrics, level.width, level.height, level.flip)
        return { model, clientW: canvas.clientWidth, clientH: canvas.clientHeight, imageId: current.imageId }
    }

    const publishProjection = () => {
        const projection = currentProjection()
        if (projection) useViewportProjection.getState().publish(projection.model, projection.clientW, projection.clientH, projection.imageId)
        else useViewportProjection.getState().clear()
    }

    const scheduleRender = () => {
        if (rafRef.current != null) return
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            rendererRef.current?.render(viewRef.current)
            publishProjection()
            const canvas = canvasRef.current
            if (canvas && hasToneCapture()) runToneCapture(canvas)
        })
    }

    const fetchAndUpload = async (payload: LevelReadyPayload) => {
        const renderer = rendererRef.current
        if (!renderer) return
        const known = usePlaylist.getState().best[payload.imageId]
        if (known && LEVEL_RANK[known.level] > LEVEL_RANK[payload.level]) return
        const key = `${payload.imageId}:${payload.level}`
        fetchesRef.current.get(key)?.abort()
        const controller = new AbortController()
        fetchesRef.current.set(key, controller)
        try {
            const pixels = await fetchPixels(payload.imageId, payload.level, payload.rev, controller.signal)
            if (controller.signal.aborted) return
            if (pixels.kind === 'jpeg') {
                const bitmap = await createImageBitmap(pixels.blob, { imageOrientation: 'none', colorSpaceConversion: 'none' })
                if (controller.signal.aborted) {
                    bitmap.close()
                    return
                }
                const ok = renderer.uploadL0({ imageId: payload.imageId, width: bitmap.width, height: bitmap.height, flip: payload.flip }, bitmap)
                bitmap.close()
                if (!ok) return
            } else {
                const ok = renderer.uploadAeth(
                    { imageId: payload.imageId, width: pixels.width, height: pixels.height, flip: payload.flip, colorMatrix: payload.colorMatrix },
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
            if (fetchesRef.current.get(key) === controller) fetchesRef.current.delete(key)
        }
    }

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        let renderer: Renderer
        try {
            renderer = new Renderer(canvas)
        } catch {
            setGpuError(true)
            return
        }
        rendererRef.current = renderer
        const api = createEngineApi(renderer, scheduleRender)
        engineRef.current = api
        setEngine(api)
        setCaps({ lowPrecision: renderer.lowPrecision, displaySpace: renderer.displaySpace })
        renderer.resize()
        scheduleRender()

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
                viewRef.current = zoomAboutCursor(viewRef.current, metrics, cursorPoint(event, canvas, metrics.dpr), Math.exp(-event.deltaY * 0.01))
            } else {
                const pan = { x: viewRef.current.pan.x - event.deltaX * metrics.dpr, y: viewRef.current.pan.y + event.deltaY * metrics.dpr }
                viewRef.current = { ...viewRef.current, pan: clampPan(pan, viewRef.current, metrics) }
            }
            scheduleRender()
        }

        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return
            const pin = event.shiftKey && !spaceRef.current
            dragRef.current = { x: event.clientX, y: event.clientY, panning: spaceRef.current, moved: false, pin }
            if (spaceRef.current || pin) canvas.setPointerCapture(event.pointerId)
        }

        const onPointerMove = (event: PointerEvent) => {
            const drag = dragRef.current
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
            const pan = { x: viewRef.current.pan.x + dx * metrics.dpr, y: viewRef.current.pan.y - dy * metrics.dpr }
            viewRef.current = { ...viewRef.current, pan: clampPan(pan, viewRef.current, metrics) }
            scheduleRender()
        }

        const onPointerUp = (event: PointerEvent) => {
            const drag = dragRef.current
            dragRef.current = null
            if (!drag) return
            if (drag.pin) {
                if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
                if (drag.moved) return
                const projection = currentProjection()
                if (!projection) return
                const rect = canvas.getBoundingClientRect()
                const uv = canvasToUv(projection.model, projection.clientW, projection.clientH, event.clientX - rect.left, event.clientY - rect.top)
                if (!uv) return
                useSamplerPins.getState().add(projection.imageId, uv.u, uv.v)
                scheduleRender()
                return
            }
            if (drag.panning) {
                if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
                return
            }
            if (drag.moved) return
            const metrics = renderer.getMetrics()
            if (!metrics) return
            viewRef.current = toggleFit(viewRef.current, metrics, cursorPoint(event, canvas, metrics.dpr))
            scheduleRender()
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (isEditableTarget(document.activeElement)) return
            if (event.code === KEYMAP.pan.modifier) {
                spaceRef.current = true
                event.preventDefault()
                return
            }
            if (!event.metaKey && event.code === KEYMAP.zoom.toggleFit) {
                const metrics = renderer.getMetrics()
                if (metrics) {
                    viewRef.current = toggleFit(viewRef.current, metrics, { x: 0, y: 0 })
                    scheduleRender()
                }
                event.preventDefault()
                return
            }
            if (event.metaKey && event.code === KEYMAP.zoom.fit) {
                viewRef.current = { fit: true, zoom: viewRef.current.zoom, pan: { x: 0, y: 0 } }
                scheduleRender()
                event.preventDefault()
                return
            }
            if (event.metaKey && event.code === KEYMAP.zoom.actual) {
                viewRef.current = zoomTo(1)
                scheduleRender()
                event.preventDefault()
                return
            }
            if (event.metaKey && event.code === KEYMAP.zoom.double) {
                viewRef.current = zoomTo(2)
                scheduleRender()
                event.preventDefault()
            }
        }

        const onKeyUp = (event: KeyboardEvent) => {
            if (event.code === KEYMAP.pan.modifier) spaceRef.current = false
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
            if (command === 'fit') viewRef.current = { fit: true, zoom: viewRef.current.zoom, pan: { x: 0, y: 0 } }
            else if (command === 'actual') viewRef.current = zoomTo(1)
            else if (command === 'double') viewRef.current = zoomTo(2)
            else viewRef.current = toggleFit(viewRef.current, metrics, { x: 0, y: 0 })
            scheduleRender()
        })

        return () => {
            observer.disconnect()
            unsubZoom()
            canvas.removeEventListener('wheel', onWheel)
            canvas.removeEventListener('pointerdown', onPointerDown)
            canvas.removeEventListener('pointermove', onPointerMove)
            canvas.removeEventListener('pointerup', onPointerUp)
            canvas.removeEventListener('pointercancel', onPointerUp)
            canvas.removeEventListener('webglcontextlost', onContextLost)
            canvas.removeEventListener('webglcontextrestored', onContextRestored)
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp)
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
            rafRef.current = null
            for (const controller of fetchesRef.current.values()) controller.abort()
            fetchesRef.current.clear()
            renderer.dispose()
            rendererRef.current = null
            engineRef.current = null
            setEngine(null)
        }
    }, [])

    useEffect(() => {
        let disposed = false
        const unlisteners: Array<() => void> = []
        const register = async () => {
            const level = await onLevelReady((payload) => {
                const state = usePlaylist.getState()
                const index = state.entries.findIndex((entry) => entry.imageId === payload.imageId)
                if (index < 0 || Math.abs(index - state.currentIndex) > WINDOW_RADIUS) return
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
            unlisteners.push(level, failed)
        }
        register()
        return () => {
            disposed = true
            for (const unlisten of unlisteners) unlisten()
        }
    }, [])

    useEffect(() => {
        const renderer = rendererRef.current
        if (!renderer) return
        renderer.setCurrent(entries[currentIndex]?.imageId ?? null)
        const windowIds = neighbors(entries, currentIndex, WINDOW_RADIUS).windowIds
        renderer.setWindow(windowIds)
        for (const [key, controller] of fetchesRef.current) {
            const imageId = key.slice(0, key.lastIndexOf(':'))
            if (!windowIds.includes(imageId)) {
                controller.abort()
                fetchesRef.current.delete(key)
            }
        }
        scheduleRender()
    }, [currentIndex, entries])

    useEffect(
        () =>
            useHistogram.subscribe((state, previous) => {
                if (state.hoverRange !== previous.hoverRange) scheduleRender()
            }),
        [],
    )

    return { canvasRef, caps, gpuError, engine }
}
