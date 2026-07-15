import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import { useHistogram } from '../../store/histogramStore'
import { setToneCapture } from './toneHighlight'

const SAMPLE_EDGE = 200
const DIM_ALPHA = 140

const srgbToLinear = (channel: number) => {
    const s = channel / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

const displayLuma = (r: number, g: number, b: number) => {
    const y = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
    return y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055
}

export const HistogramHoverOverlay: FC = () => {
    const overlayRef = useRef<HTMLCanvasElement>(null)
    const offscreenRef = useRef<HTMLCanvasElement | null>(null)
    const hoverRange = useHistogram((state) => state.hoverRange)

    useEffect(() => {
        if (!hoverRange) {
            setToneCapture(null)
            return
        }
        const lo = hoverRange.lo
        const hi = hoverRange.hi
        setToneCapture((source) => {
            const overlay = overlayRef.current
            if (!overlay || source.width === 0 || source.height === 0) return
            const long = Math.max(source.width, source.height)
            const ratio = long > SAMPLE_EDGE ? SAMPLE_EDGE / long : 1
            const ow = Math.max(1, Math.round(source.width * ratio))
            const oh = Math.max(1, Math.round(source.height * ratio))
            let off = offscreenRef.current
            if (!off) {
                off = document.createElement('canvas')
                offscreenRef.current = off
            }
            off.width = ow
            off.height = oh
            const octx = off.getContext('2d', { willReadFrequently: true })
            if (!octx) return
            octx.drawImage(source, 0, 0, ow, oh)
            const image = octx.getImageData(0, 0, ow, oh)
            const data = image.data
            for (let i = 0; i < data.length; i += 4) {
                const luma = displayLuma(data[i], data[i + 1], data[i + 2])
                data[i] = 0
                data[i + 1] = 0
                data[i + 2] = 0
                data[i + 3] = luma >= lo && luma <= hi ? 0 : DIM_ALPHA
            }
            octx.putImageData(image, 0, 0)
            overlay.width = source.width
            overlay.height = source.height
            const ctx = overlay.getContext('2d')
            if (!ctx) return
            ctx.clearRect(0, 0, overlay.width, overlay.height)
            ctx.imageSmoothingEnabled = true
            ctx.drawImage(off, 0, 0, overlay.width, overlay.height)
        })
        return () => setToneCapture(null)
    }, [hoverRange])

    if (!hoverRange) return null
    return <canvas ref={overlayRef} className='pointer-events-none absolute inset-0 h-full w-full' />
}
