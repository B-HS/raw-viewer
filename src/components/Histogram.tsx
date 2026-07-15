import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useHistogram } from '../store/histogramStore'
import type { HistogramData, HistogramMode } from '../store/histogramStore'
import { useUiStore } from '../store/uiStore'

const BINS = 256

const drawChannel = (ctx: CanvasRenderingContext2D, bins: Uint32Array, width: number, height: number, scale: number, style: string) => {
    ctx.beginPath()
    ctx.moveTo(0, height)
    for (let i = 0; i < BINS; i++) {
        const x = (i / (BINS - 1)) * width
        const y = height - Math.min(1, bins[i] * scale) * height
        ctx.lineTo(x, y)
    }
    ctx.lineTo(width, height)
    ctx.closePath()
    ctx.fillStyle = style
    ctx.fill()
}

const maxBin = (data: HistogramData) => {
    let peak = 1
    for (let i = 1; i < BINS - 1; i++) {
        peak = Math.max(peak, data.r[i], data.g[i], data.b[i], data.luma[i])
    }
    return peak
}

const render = (canvas: HTMLCanvasElement, data: HistogramData | null, mode: HistogramMode) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)
    if (!data) return
    const scale = 1 / maxBin(data)
    if (mode === 'luma') {
        drawChannel(ctx, data.luma, width, height, scale, 'rgba(220,220,220,0.85)')
        return
    }
    if (mode === 'separate') {
        const third = height / 3
        ctx.save()
        ctx.translate(0, 0)
        drawChannel(ctx, data.r, width, third, scale, 'rgba(255,80,80,0.85)')
        ctx.translate(0, third)
        drawChannel(ctx, data.g, width, third, scale, 'rgba(80,220,120,0.85)')
        ctx.translate(0, third)
        drawChannel(ctx, data.b, width, third, scale, 'rgba(90,140,255,0.85)')
        ctx.restore()
        return
    }
    ctx.globalCompositeOperation = 'lighter'
    drawChannel(ctx, data.r, width, height, scale, 'rgba(255,60,60,0.6)')
    drawChannel(ctx, data.g, width, height, scale, 'rgba(60,220,110,0.6)')
    drawChannel(ctx, data.b, width, height, scale, 'rgba(70,130,255,0.6)')
    ctx.globalCompositeOperation = 'source-over'
}

export const Histogram: FC = () => {
    const { t } = useTranslation()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const data = useHistogram((state) => state.data)
    const mode = useHistogram((state) => state.mode)
    const clipping = useUiStore((state) => state.clipping)
    const modeLabel = t(`histogram.${mode}`)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const resize = () => {
            const dpr = window.devicePixelRatio || 1
            canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr))
            canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr))
            render(canvas, useHistogram.getState().data, useHistogram.getState().mode)
        }
        resize()
        const observer = new ResizeObserver(resize)
        observer.observe(canvas)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        const canvas = canvasRef.current
        if (canvas) render(canvas, data, mode)
    }, [data, mode])

    const hiActive = clipping === 'both' || clipping === 'highlight'
    const loActive = clipping === 'both' || clipping === 'shadow'

    return (
        <div className='relative border-b border-neutral-800 bg-neutral-950'>
            <button
                type='button'
                onClick={() => useUiStore.getState().toggleClipping('shadow')}
                aria-label={t('histogram.shadowClipAria')}
                className={`absolute left-1 top-1 z-10 h-0 w-0 border-b-8 border-r-8 border-b-transparent ${loActive ? 'border-r-blue-400' : 'border-r-neutral-600'}`}
            />
            <button
                type='button'
                onClick={() => useUiStore.getState().toggleClipping('highlight')}
                aria-label={t('histogram.highlightClipAria')}
                className={`absolute right-1 top-1 z-10 h-0 w-0 border-b-8 border-l-8 border-b-transparent ${hiActive ? 'border-l-red-400' : 'border-l-neutral-600'}`}
            />
            <canvas
                ref={canvasRef}
                onClick={() => useHistogram.getState().cycleMode()}
                className='block h-24 w-full cursor-pointer'
                aria-label={t('histogram.aria', { mode: modeLabel })}
            />
            <span className='pointer-events-none absolute bottom-1 right-2 text-[10px] text-neutral-500'>{modeLabel}</span>
        </div>
    )
}
