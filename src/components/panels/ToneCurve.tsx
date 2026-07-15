import { useRef, useState } from 'react'
import type { FC } from 'react'
import { MAX_CURVE_POINTS, sampleMonotoneCurve } from '../../store/curve'
import { useEditStore } from '../../store/editStore'
import { useHistogram } from '../../store/histogramStore'
import { useHistoryStore } from '../../store/historyStore'
import type { BaseCurveMode } from '../../types/BaseCurveMode'
import type { CurvePoint } from '../../types/CurvePoint'
import type { CurvesState } from '../../types/CurvesState'
import { Section } from './Section'

const SIZE = 256
const SAMPLES = 129
const MIN_DX = 0.004
const NEAR = 0.02

type Channel = keyof CurvesState

const CHANNELS: { id: Channel; label: string; color: string }[] = [
    { id: 'rgb', label: 'RGB', color: '#e5e5e5' },
    { id: 'red', label: 'R', color: '#ff6b6b' },
    { id: 'green', label: 'G', color: '#6bff8f' },
    { id: 'blue', label: 'B', color: '#6b9bff' },
]

const BASE_CURVES: { id: BaseCurveMode; label: string }[] = [
    { id: 'linear', label: '선형' },
    { id: 'standard', label: '표준' },
    { id: 'filmic', label: '필름' },
]

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

const curvePath = (points: CurvePoint[]) => {
    const samples = sampleMonotoneCurve(points, SAMPLES)
    let path = ''
    for (let i = 0; i < SAMPLES; i++) {
        const x = (i / (SAMPLES - 1)) * SIZE
        const y = (1 - samples[i]) * SIZE
        path += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)} `
    }
    return path
}

const histogramPath = (bins: Uint32Array) => {
    let peak = 1
    for (let i = 1; i < bins.length - 1; i++) peak = Math.max(peak, bins[i])
    let path = `M0 ${SIZE} `
    for (let i = 0; i < bins.length; i++) {
        const x = (i / (bins.length - 1)) * SIZE
        const y = SIZE - Math.min(1, bins[i] / peak) * SIZE
        path += `L${x.toFixed(2)} ${y.toFixed(2)} `
    }
    return `${path}L${SIZE} ${SIZE} Z`
}

export const ToneCurve: FC = () => {
    const svgRef = useRef<SVGSVGElement>(null)
    const dragRef = useRef<number | null>(null)
    const [channel, setChannel] = useState<Channel>('rgb')
    const curves = useEditStore((state) => state.state?.curves)
    const baseCurve = useEditStore((state) => state.state?.baseCurve)
    const luma = useHistogram((state) => state.data?.luma)
    const edit = useEditStore((state) => state.edit)

    if (!curves || !baseCurve) return null

    const active = CHANNELS.find((entry) => entry.id === channel) ?? CHANNELS[0]
    const points = curves[channel]

    const coalesceKey = `curves.${channel}`
    const commit = (next: CurvePoint[], label: string, discrete: boolean) =>
        edit((draft) => void (draft.curves[channel] = next), discrete ? { label } : { coalesceKey, label })

    const pointerNorm = (event: React.PointerEvent | React.MouseEvent) => {
        const rect = svgRef.current?.getBoundingClientRect()
        if (!rect) return { x: 0, y: 0 }
        return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01(1 - (event.clientY - rect.top) / rect.height) }
    }

    const movePoint = (index: number, x: number, y: number) => {
        const nextX =
            index === 0 ? 0 : index === points.length - 1 ? 1 : Math.min(Math.max(x, points[index - 1].x + MIN_DX), points[index + 1].x - MIN_DX)
        const next = points.map((point, i) => (i === index ? { x: nextX, y: clamp01(y) } : point))
        commit(next, `${active.label} 커브`, false)
    }

    const onPointDown = (index: number) => (event: React.PointerEvent) => {
        event.stopPropagation()
        dragRef.current = index
        useHistoryStore.getState().beginCoalesce(coalesceKey)
        svgRef.current?.setPointerCapture(event.pointerId)
    }
    const onSvgMove = (event: React.PointerEvent) => {
        if (dragRef.current === null) return
        const position = pointerNorm(event)
        movePoint(dragRef.current, position.x, position.y)
    }
    const onSvgUp = (event: React.PointerEvent) => {
        if (dragRef.current === null) return
        dragRef.current = null
        if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId)
        useHistoryStore.getState().endCoalesce()
    }
    const onAdd = (event: React.PointerEvent) => {
        if (event.button !== 0 || points.length >= MAX_CURVE_POINTS) return
        const position = pointerNorm(event)
        if (points.some((point) => Math.abs(point.x - position.x) < NEAR)) return
        const next = [...points, position].sort((a, b) => a.x - b.x)
        commit(next, `${active.label} 점 추가`, true)
    }
    const onDeletePoint = (index: number) => (event: React.MouseEvent) => {
        event.stopPropagation()
        if (points.length <= 2 || index === 0 || index === points.length - 1) return
        commit(
            points.filter((_, i) => i !== index),
            `${active.label} 점 삭제`,
            true,
        )
    }

    return (
        <Section id='tone-curve' title='톤 커브'>
            <div className='flex gap-1'>
                {CHANNELS.map((entry) => (
                    <button
                        key={entry.id}
                        type='button'
                        onClick={() => setChannel(entry.id)}
                        className={`flex-1 rounded py-1 text-xs ${channel === entry.id ? 'bg-neutral-700 text-neutral-100' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}`}
                        style={{ color: channel === entry.id ? entry.color : undefined }}>
                        {entry.label}
                    </button>
                ))}
            </div>
            <svg
                ref={svgRef}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className='aspect-square w-full touch-none rounded bg-neutral-950'
                onPointerDown={onAdd}
                onPointerMove={onSvgMove}
                onPointerUp={onSvgUp}
                onPointerCancel={onSvgUp}>
                {luma && <path d={histogramPath(luma)} fill='rgba(140,140,140,0.25)' />}
                <line x1='0' y1={SIZE} x2={SIZE} y2='0' stroke='rgba(255,255,255,0.12)' strokeWidth='1' />
                {[64, 128, 192].map((value) => (
                    <g key={value}>
                        <line x1={value} y1='0' x2={value} y2={SIZE} stroke='rgba(255,255,255,0.06)' strokeWidth='1' />
                        <line x1='0' y1={value} x2={SIZE} y2={value} stroke='rgba(255,255,255,0.06)' strokeWidth='1' />
                    </g>
                ))}
                <path d={curvePath(points)} fill='none' stroke={active.color} strokeWidth='2' strokeLinejoin='round' />
                {points.map((point, index) => (
                    <circle
                        key={index}
                        cx={point.x * SIZE}
                        cy={(1 - point.y) * SIZE}
                        r={9}
                        fill='transparent'
                        style={{ cursor: 'grab' }}
                        onPointerDown={onPointDown(index)}
                        onDoubleClick={onDeletePoint(index)}
                    />
                ))}
                {points.map((point, index) => (
                    <circle key={`dot-${index}`} cx={point.x * SIZE} cy={(1 - point.y) * SIZE} r={3.5} fill={active.color} pointerEvents='none' />
                ))}
            </svg>
            <div className='flex items-center gap-1'>
                <span className='text-[10px] text-neutral-500'>베이스</span>
                {BASE_CURVES.map((entry) => (
                    <button
                        key={entry.id}
                        type='button'
                        onClick={() => edit((draft) => void (draft.baseCurve = entry.id), { label: '베이스 커브' })}
                        className={`flex-1 rounded py-1 text-[11px] ${baseCurve === entry.id ? 'bg-neutral-700 text-neutral-100' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'}`}>
                        {entry.label}
                    </button>
                ))}
            </div>
        </Section>
    )
}
