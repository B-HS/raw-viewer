import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { dispDims } from '../../gl/viewTransform'
import { i18n } from '../../i18n/i18n'
import { renderCpuFrame } from '../../ipc/commands'
import { onCpuFrameReady } from '../../ipc/events'
import { fetchCpuFrame } from '../../ipc/pixels'
import { useEditStore } from '../../store/editStore'
import { usePlaylist } from '../../store/playlist'
import { useToast } from '../../store/toast'
import { flipDegrees } from './projection'

const EDIT_DEBOUNCE_MS = 300
const MIN_MAX_EDGE = 1024
const MAX_MAX_EDGE = 4096
const DEFAULT_MAX_EDGE = 2048
const MIN_ZOOM = 0.1
const MAX_ZOOM = 16
const WHEEL_ZOOM_SENSITIVITY = 0.01

type Frame = { w: number; h: number; flip: number }
type View = { zoom: number; panX: number; panY: number }

const FIT_VIEW: View = { zoom: 1, panX: 0, panY: 0 }

export const CpuFallbackView: FC = () => {
    const { t } = useTranslation()
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const currentIdRef = useRef<string | null>(null)
    const lastStateRef = useRef<unknown>(null)
    const editTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const dragRef = useRef<{ x: number; y: number } | null>(null)
    const failedIdRef = useRef<string | null>(null)
    const [container, setContainer] = useState({ w: 0, h: 0 })
    const [frame, setFrame] = useState<Frame | null>(null)
    const [view, setView] = useState<View>(FIT_VIEW)
    const [busy, setBusy] = useState(false)

    const imageId = usePlaylist((state) => state.entries[state.currentIndex]?.imageId ?? null)
    currentIdRef.current = imageId

    const maxEdge = () => {
        const dpr = window.devicePixelRatio || 1
        const long = Math.max(container.w, container.h)
        if (long <= 0) return DEFAULT_MAX_EDGE
        return Math.max(MIN_MAX_EDGE, Math.min(MAX_MAX_EDGE, Math.round(long * dpr)))
    }

    const request = () => {
        const id = currentIdRef.current
        if (!id) return
        setBusy(true)
        renderCpuFrame(id, maxEdge())
            .catch(() => undefined)
            .finally(() => {
                if (currentIdRef.current === id) setBusy(false)
            })
    }
    const requestRef = useRef(request)
    requestRef.current = request

    const draw = async (imageIdForFrame: string, rev: number, flip: number) => {
        if (imageIdForFrame !== currentIdRef.current) return
        try {
            const decoded = await fetchCpuFrame(imageIdForFrame, rev)
            if (imageIdForFrame !== currentIdRef.current) return
            const canvas = canvasRef.current
            const ctx = canvas?.getContext('2d')
            if (!canvas || !ctx) return
            canvas.width = decoded.width
            canvas.height = decoded.height
            ctx.putImageData(new ImageData(decoded.data, decoded.width, decoded.height), 0, 0)
            setFrame({ w: decoded.width, h: decoded.height, flip })
        } catch {
            if (imageIdForFrame === currentIdRef.current && failedIdRef.current !== imageIdForFrame) {
                failedIdRef.current = imageIdForFrame
                useToast.getState().show(i18n.t('toast.cpuFrameFailed'))
            }
        }
    }
    const drawRef = useRef(draw)
    drawRef.current = draw

    const onPointerDown = (event: React.PointerEvent) => {
        if (event.button !== 0) return
        dragRef.current = { x: event.clientX, y: event.clientY }
        event.currentTarget.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: React.PointerEvent) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = event.clientX - drag.x
        const dy = event.clientY - drag.y
        drag.x = event.clientX
        drag.y = event.clientY
        setView((current) => ({ ...current, panX: current.panX + dx, panY: current.panY + dy }))
    }
    const onPointerUp = (event: React.PointerEvent) => {
        dragRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const flip = frame?.flip ?? 0
    const disp = frame ? dispDims(frame.w, frame.h, flip) : { dispW: 1, dispH: 1 }
    const fitScale = container.w > 0 && disp.dispW > 0 ? Math.min(container.w / disp.dispW, container.h / disp.dispH) : 1
    const scale = fitScale * view.zoom
    const transform = `translate(-50%, -50%) translate(${view.panX}px, ${view.panY}px) rotate(${flipDegrees(flip)}deg) scale(${scale})`

    useEffect(() => {
        const element = containerRef.current
        if (!element) return
        const measure = () => setContainer({ w: element.clientWidth, h: element.clientHeight })
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        let disposed = false
        let unlisten: (() => void) | null = null
        onCpuFrameReady((payload) => drawRef.current(payload.imageId, payload.rev, payload.flip))
            .then((dispose) => (disposed ? dispose() : (unlisten = dispose)))
            .catch(() => undefined)
        return () => {
            disposed = true
            unlisten?.()
        }
    }, [])

    useEffect(() => {
        lastStateRef.current = useEditStore.getState().state
        setView(FIT_VIEW)
        setFrame(null)
        if (imageId) requestRef.current()
        return () => {
            if (editTimerRef.current) clearTimeout(editTimerRef.current)
            editTimerRef.current = null
        }
    }, [imageId])

    useEffect(() => {
        const unsubscribe = useEditStore.subscribe((state) => {
            if (state.state === lastStateRef.current) return
            lastStateRef.current = state.state
            if (state.imageId !== currentIdRef.current) return
            if (editTimerRef.current) clearTimeout(editTimerRef.current)
            editTimerRef.current = setTimeout(() => requestRef.current(), EDIT_DEBOUNCE_MS)
        })
        return unsubscribe
    }, [])

    useEffect(() => {
        const element = containerRef.current
        if (!element) return
        const onWheel = (event: WheelEvent) => {
            event.preventDefault()
            setView((current) => ({
                ...current,
                zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY))),
            }))
        }
        element.addEventListener('wheel', onWheel, { passive: false })
        return () => element.removeEventListener('wheel', onWheel)
    }, [])

    return (
        <div ref={containerRef} className='absolute inset-0 touch-none overflow-hidden bg-viewport'>
            <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={() => setView(FIT_VIEW)}
                className={`absolute left-1/2 top-1/2 origin-center ${frame ? '' : 'hidden'}`}
                style={{ transform, imageRendering: view.zoom > 1 ? 'pixelated' : 'auto', cursor: 'grab' }}
            />
            <div className='pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-amber-500/90 px-2.5 py-1 text-xs font-medium text-black shadow'>
                {t('viewport.cpuFallbackBadge')}
            </div>
            {busy && !frame && (
                <div className='pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-neutral-300'>
                    <span className='h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-200' />
                    {t('viewport.cpuRendering')}
                </div>
            )}
            {busy && frame && (
                <div className='pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 rounded bg-black/60 px-2.5 py-1 text-xs text-neutral-200'>
                    <span className='h-3 w-3 animate-spin rounded-full border-2 border-neutral-500 border-t-neutral-200' />
                    {t('viewport.cpuRendering')}
                </div>
            )}
        </div>
    )
}
