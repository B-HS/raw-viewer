import { useEffect, useState } from 'react'
import type { FC } from 'react'
import { usePlaylist } from '../../store/playlist'
import { useSamplerPins } from '../../store/samplerPins'
import { useUiStore } from '../../store/uiStore'
import { useViewportProjection } from '../../store/viewportProjection'
import type { SamplerPin, SamplerUnit } from '../../store/samplerPins'
import { rec2020LinearToSrgb } from './sampling'
import { uvToCanvas } from './projection'

type Resolved = { pin: SamplerPin; x: number; y: number; text: string; swatch: string }

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)))

const hex = (value: number) => clampByte(value).toString(16).padStart(2, '0')

const formatValue = (unit: SamplerUnit, srgb: [number, number, number]) => {
    if (unit === 'byte') return `${clampByte(srgb[0])} ${clampByte(srgb[1])} ${clampByte(srgb[2])}`
    if (unit === 'hex') return `#${hex(srgb[0])}${hex(srgb[1])}${hex(srgb[2])}`
    return `${Math.round(srgb[0] * 100)} ${Math.round(srgb[1] * 100)} ${Math.round(srgb[2] * 100)}%`
}

const PinsLive: FC<{ imageId: string; pins: SamplerPin[] }> = ({ imageId, pins }) => {
    const nonce = useViewportProjection((state) => state.nonce)
    const [resolved, setResolved] = useState<Resolved[]>([])

    useEffect(() => {
        const projection = useViewportProjection.getState()
        const engine = useUiStore.getState().engine
        if (!projection.model || projection.imageId !== imageId || !engine) {
            setResolved([])
            return
        }
        const next: Resolved[] = []
        for (const pin of pins) {
            const point = uvToCanvas(projection.model, projection.clientW, projection.clientH, pin.u, pin.v)
            const sample = engine.samplePixel(point.x, point.y)
            const srgb = sample ? rec2020LinearToSrgb(sample.r, sample.g, sample.b) : ([0, 0, 0] as [number, number, number])
            const swatch = `rgb(${clampByte(srgb[0])}, ${clampByte(srgb[1])}, ${clampByte(srgb[2])})`
            next.push({ pin, x: point.x, y: point.y, text: sample ? formatValue(pin.unit, srgb) : '—', swatch })
        }
        setResolved(next)
    }, [nonce, pins, imageId])

    return (
        <>
            {resolved.map((item) => (
                <div key={item.pin.id} className='pointer-events-none absolute' style={{ left: item.x, top: item.y }}>
                    <div className='absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]' />
                    <div className='pointer-events-auto absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded bg-black/75 px-1.5 py-1 text-[10px] text-neutral-100 shadow'>
                        <button
                            type='button'
                            onClick={() => useSamplerPins.getState().cycleUnit(imageId, item.pin.id)}
                            className='flex items-center gap-1.5'>
                            <span className='h-3 w-3 rounded-sm border border-white/40' style={{ backgroundColor: item.swatch }} />
                            <span className='tabular-nums'>{item.text}</span>
                        </button>
                        <button
                            type='button'
                            onClick={() => useSamplerPins.getState().remove(imageId, item.pin.id)}
                            className='px-0.5 text-neutral-400 hover:text-neutral-100'>
                            ✕
                        </button>
                    </div>
                </div>
            ))}
        </>
    )
}

export const SamplerPinsOverlay: FC = () => {
    const imageId = usePlaylist((state) => state.entries[state.currentIndex]?.imageId ?? null)
    const pins = useSamplerPins((state) => (imageId ? state.pins[imageId] : undefined))
    if (!imageId || !pins || pins.length === 0) return null
    return <PinsLive imageId={imageId} pins={pins} />
}
