import { useRef } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { qbezControl } from '../../gl/scan'
import { useEditStore } from '../../store/editStore'
import { useHistoryStore } from '../../store/historyStore'
import { setScanCorner, setScanEdge } from '../../store/scan'
import { useViewportProjection } from '../../store/viewportProjection'
import { canvasToUvUnclamped, uvToCanvas } from './projection'

type ScanDrag = { kind: 'corner' | 'edge'; index: number }

const EDGE_PATH_ORDER: { edge: number; from: number; to: number }[] = [
    { edge: 0, from: 0, to: 1 },
    { edge: 1, from: 1, to: 2 },
    { edge: 2, from: 2, to: 3 },
    { edge: 3, from: 3, to: 0 },
]

export const ScanOverlay: FC = () => {
    const rootRef = useRef<HTMLDivElement>(null)
    const dragRef = useRef<ScanDrag | null>(null)
    const scan = useEditStore((state) => state.state?.scan)
    const model = useViewportProjection((state) => state.model)
    const clientW = useViewportProjection((state) => state.clientW)
    const clientH = useViewportProjection((state) => state.clientH)

    const { t } = useTranslation()

    if (!scan || !model) return null

    const toCanvas = (point: readonly [number, number]) => uvToCanvas(model, clientW, clientH, point[0], point[1])
    const cornersPx = scan.corners.map(toCanvas)
    const edgesPx = scan.edges.map(toCanvas)
    const pathD = EDGE_PATH_ORDER.map(({ edge, from, to }, index) => {
        const start = toCanvas(scan.corners[from])
        const control = toCanvas(qbezControl(scan.corners[from], scan.edges[edge], scan.corners[to]))
        const end = toCanvas(scan.corners[to])
        return `${index === 0 ? `M ${start.x} ${start.y} ` : ''}Q ${control.x} ${control.y} ${end.x} ${end.y}`
    }).join(' ')

    const onDown = (drag: ScanDrag, event: React.PointerEvent) => {
        event.stopPropagation()
        dragRef.current = drag
        useHistoryStore.getState().beginCoalesce('scan.handle')
        rootRef.current?.setPointerCapture(event.pointerId)
    }
    const onMove = (event: React.PointerEvent) => {
        const drag = dragRef.current
        if (!drag) return
        const rect = event.currentTarget.getBoundingClientRect()
        const uv = canvasToUvUnclamped(model, clientW, clientH, event.clientX - rect.left, event.clientY - rect.top)
        if (!uv) return
        if (drag.kind === 'corner') setScanCorner(drag.index, uv.u, uv.v)
        else setScanEdge(drag.index, uv.u, uv.v)
    }
    const onUp = (event: React.PointerEvent) => {
        if (!dragRef.current) return
        dragRef.current = null
        if (rootRef.current?.hasPointerCapture(event.pointerId)) rootRef.current.releasePointerCapture(event.pointerId)
        useHistoryStore.getState().endCoalesce()
    }

    return (
        <div ref={rootRef} className='absolute inset-0 touch-none' onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <svg className='pointer-events-none absolute inset-0 h-full w-full'>
                <path d={pathD} fill='rgba(56, 189, 248, 0.08)' stroke='rgba(56, 189, 248, 0.9)' strokeWidth='1.5' />
            </svg>
            {cornersPx.map((point, index) => (
                <div
                    key={`corner-${index}`}
                    role='button'
                    aria-label={t('panel.crop.scanCornerAria', { index: index + 1 })}
                    onPointerDown={(event) => onDown({ kind: 'corner', index }, event)}
                    className='absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-sky-300 bg-neutral-900/80'
                    style={{ left: point.x, top: point.y }}
                />
            ))}
            {edgesPx.map((point, index) => (
                <div
                    key={`edge-${index}`}
                    role='button'
                    aria-label={t('panel.crop.scanEdgeAria', { index: index + 1 })}
                    onPointerDown={(event) => onDown({ kind: 'edge', index }, event)}
                    className='absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-sm border border-sky-300 bg-sky-500/60'
                    style={{ left: point.x, top: point.y }}
                />
            ))}
        </div>
    )
}
