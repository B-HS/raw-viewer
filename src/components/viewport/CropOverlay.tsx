import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { scanOutputDims } from '../../gl/scan'
import { composeFlip, dispDims } from '../../gl/viewTransform'
import { cropDisplayRatio, displayToSource, setCropRect, sourceToDisplay } from '../../store/crop'
import { useEditStore } from '../../store/editStore'
import { useHistoryStore } from '../../store/historyStore'
import { usePlaylist } from '../../store/playlist'
import { useUiStore } from '../../store/uiStore'
import type { CropOverlayStyle } from '../../store/uiStore'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'
type RectPx = { x: number; y: number; w: number; h: number }

const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN_PX = 24

const clamp = (value: number, lo: number, hi: number) => (value < lo ? lo : value > hi ? hi : value)

const gridLines = (style: CropOverlayStyle) => {
    if (style === 'thirds') return [1 / 3, 2 / 3]
    if (style === 'golden') return [0.382, 0.618]
    return []
}

const handlePosition = (handle: Exclude<Handle, 'move'>, rect: RectPx) => ({
    left: handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.w : rect.x + rect.w / 2,
    top: handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.h : rect.y + rect.h / 2,
})

export const CropOverlay: FC = () => {
    const { t } = useTranslation()
    const rootRef = useRef<HTMLDivElement>(null)
    const dragRef = useRef<{ handle: Handle; sx: number; sy: number; rect: RectPx } | null>(null)
    const [size, setSize] = useState({ w: 0, h: 0 })
    const crop = useEditStore((state) => state.state?.crop)
    const scan = useEditStore((state) => state.state?.scan)
    const rotate90 = useEditStore((state) => state.state?.geometry.rotate90 ?? 0)
    const currentIndex = usePlaylist((state) => state.currentIndex)
    const entries = usePlaylist((state) => state.entries)
    const best = usePlaylist((state) => state.best)
    const overlayStyle = useUiStore((state) => state.cropOverlay)

    useEffect(() => {
        const element = rootRef.current
        if (!element) return
        const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight })
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    const current = entries[currentIndex]
    const payload = current ? best[current.imageId] : undefined
    if (!crop || !crop.enabled || !payload || size.w === 0 || size.h === 0)
        return <div ref={rootRef} className='pointer-events-none absolute inset-0' />

    const orientedFlip = composeFlip(payload.flip, rotate90)
    const scanDims = scanOutputDims(payload.width, payload.height, scan)
    const { dispW, dispH } = dispDims(scanDims.w, scanDims.h, orientedFlip)
    const fit = Math.min(size.w / dispW, size.h / dispH)
    const iw = dispW * fit
    const ih = dispH * fit
    const ix = (size.w - iw) / 2
    const iy = (size.h - ih) / 2

    const display = sourceToDisplay({ left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom }, orientedFlip)
    const rect: RectPx = {
        x: ix + display.left * iw,
        y: iy + display.top * ih,
        w: (display.right - display.left) * iw,
        h: (display.bottom - display.top) * ih,
    }
    const ratio = cropDisplayRatio(crop.aspect)

    const store = (next: RectPx) => {
        const dl = clamp((next.x - ix) / iw, 0, 1)
        const dt = clamp((next.y - iy) / ih, 0, 1)
        const dr = clamp((next.x + next.w - ix) / iw, 0, 1)
        const db = clamp((next.y + next.h - iy) / ih, 0, 1)
        setCropRect(displayToSource({ left: dl, top: dt, right: dr, bottom: db }, orientedFlip), crop.aspect)
    }

    const resize = (handle: Exclude<Handle, 'move'>, px: number, py: number, start: RectPx) => {
        const cx = clamp(px, ix, ix + iw)
        const cy = clamp(py, iy, iy + ih)
        let left = start.x
        let top = start.y
        let right = start.x + start.w
        let bottom = start.y + start.h
        if (handle.includes('w')) left = Math.min(cx, right - MIN_PX)
        if (handle.includes('e')) right = Math.max(cx, left + MIN_PX)
        if (handle.includes('n')) top = Math.min(cy, bottom - MIN_PX)
        if (handle.includes('s')) bottom = Math.max(cy, top + MIN_PX)
        if (ratio !== null) {
            if (handle.length === 2) {
                const fixedX = handle.includes('w') ? right : left
                const fixedY = handle.includes('n') ? bottom : top
                const availW = handle.includes('w') ? fixedX - ix : ix + iw - fixedX
                const availH = handle.includes('n') ? fixedY - iy : iy + ih - fixedY
                let width = Math.max(Math.abs((handle.includes('w') ? left : right) - fixedX), MIN_PX)
                let height = width / ratio
                if (width > availW) {
                    width = availW
                    height = width / ratio
                }
                if (height > availH) {
                    height = availH
                    width = height * ratio
                }
                left = handle.includes('w') ? fixedX - width : fixedX
                right = handle.includes('w') ? fixedX : fixedX + width
                top = handle.includes('n') ? fixedY - height : fixedY
                bottom = handle.includes('n') ? fixedY : fixedY + height
            } else if (handle === 'e' || handle === 'w') {
                const width = right - left
                const height = clamp(width / ratio, MIN_PX, ih)
                const center = start.y + start.h / 2
                top = clamp(center - height / 2, iy, iy + ih - height)
                bottom = top + height
            } else {
                const height = bottom - top
                const width = clamp(height * ratio, MIN_PX, iw)
                const center = start.x + start.w / 2
                left = clamp(center - width / 2, ix, ix + iw - width)
                right = left + width
            }
        }
        return { x: left, y: top, w: right - left, h: bottom - top }
    }

    const onDown = (handle: Handle, event: React.PointerEvent) => {
        event.stopPropagation()
        dragRef.current = { handle, sx: event.clientX, sy: event.clientY, rect }
        useHistoryStore.getState().beginCoalesce('crop.rect')
        rootRef.current?.setPointerCapture(event.pointerId)
    }
    const onMove = (event: React.PointerEvent) => {
        const drag = dragRef.current
        if (!drag) return
        if (drag.handle === 'move') {
            const dx = event.clientX - drag.sx
            const dy = event.clientY - drag.sy
            store({
                x: clamp(drag.rect.x + dx, ix, ix + iw - drag.rect.w),
                y: clamp(drag.rect.y + dy, iy, iy + ih - drag.rect.h),
                w: drag.rect.w,
                h: drag.rect.h,
            })
            return
        }
        store(resize(drag.handle, event.clientX, event.clientY, drag.rect))
    }
    const onUp = (event: React.PointerEvent) => {
        if (!dragRef.current) return
        dragRef.current = null
        if (rootRef.current?.hasPointerCapture(event.pointerId)) rootRef.current.releasePointerCapture(event.pointerId)
        useHistoryStore.getState().endCoalesce()
    }

    const lines = gridLines(overlayStyle)

    return (
        <div ref={rootRef} className='absolute inset-0 touch-none' onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <div className='absolute border border-white/80' style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
                <div className='absolute inset-0 cursor-move' onPointerDown={(event) => onDown('move', event)} />
                {lines.map((fraction) => (
                    <div
                        key={`v-${fraction}`}
                        className='pointer-events-none absolute top-0 h-full w-px bg-white/30'
                        style={{ left: `${fraction * 100}%` }}
                    />
                ))}
                {lines.map((fraction) => (
                    <div
                        key={`h-${fraction}`}
                        className='pointer-events-none absolute left-0 h-px w-full bg-white/30'
                        style={{ top: `${fraction * 100}%` }}
                    />
                ))}
                {overlayStyle === 'diag' && (
                    <svg className='pointer-events-none absolute inset-0 h-full w-full' viewBox='0 0 100 100' preserveAspectRatio='none'>
                        <line x1='0' y1='0' x2='100' y2='100' stroke='rgba(255,255,255,0.3)' strokeWidth='0.5' />
                        <line x1='100' y1='0' x2='0' y2='100' stroke='rgba(255,255,255,0.3)' strokeWidth='0.5' />
                    </svg>
                )}
            </div>
            {HANDLES.map((handle) => {
                const position = handlePosition(handle, rect)
                return (
                    <div
                        key={handle}
                        role='button'
                        aria-label={t('panel.crop.handleAria', { handle })}
                        onPointerDown={(event) => onDown(handle, event)}
                        className='absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-neutral-900 bg-white'
                        style={{ left: position.left, top: position.top, cursor: `${handle}-resize` }}
                    />
                )
            })}
        </div>
    )
}
