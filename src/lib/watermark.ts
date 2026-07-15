import { readWatermarkPng } from '../ipc/export'

export type WatermarkPosition =
    'top-left' | 'top-center' | 'top-right' | 'mid-left' | 'center' | 'mid-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'

export type WatermarkMode = 'text' | 'image'

export type WatermarkSettings = {
    enabled: boolean
    mode: WatermarkMode
    text: string
    sizePercent: number
    opacity: number
    position: WatermarkPosition
    marginPercent: number
    imagePath: string
}

export const WATERMARK_POSITIONS: readonly WatermarkPosition[] = [
    'top-left',
    'top-center',
    'top-right',
    'mid-left',
    'center',
    'mid-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
]

const ANCHORS: Record<WatermarkPosition, readonly [number, number]> = {
    'top-left': [0, 0],
    'top-center': [0.5, 0],
    'top-right': [1, 0],
    'mid-left': [0, 0.5],
    center: [0.5, 0.5],
    'mid-right': [1, 0.5],
    'bottom-left': [0, 1],
    'bottom-center': [0.5, 1],
    'bottom-right': [1, 1],
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

const placeBox = (position: WatermarkPosition, canvasWidth: number, canvasHeight: number, boxWidth: number, boxHeight: number, margin: number) => {
    const [ax, ay] = ANCHORS[position]
    const x = ax === 0 ? margin : ax === 1 ? canvasWidth - boxWidth - margin : (canvasWidth - boxWidth) / 2
    const y = ay === 0 ? margin : ay === 1 ? canvasHeight - boxHeight - margin : (canvasHeight - boxHeight) / 2
    return { x, y }
}

let bitmapCache: { path: string; bitmap: ImageBitmap } | null = null

export const loadWatermarkImage = async (path: string) => {
    if (!path) return null
    if (bitmapCache && bitmapCache.path === path) return bitmapCache.bitmap
    try {
        const buffer = await readWatermarkPng(path)
        const bitmap = await createImageBitmap(new Blob([buffer]))
        if (bitmapCache) bitmapCache.bitmap.close()
        bitmapCache = { path, bitmap }
        return bitmap
    } catch {
        return null
    }
}

export const renderWatermarkPng = async (outputWidth: number, outputHeight: number, watermark: WatermarkSettings, image: ImageBitmap | null) => {
    if (outputWidth < 1 || outputHeight < 1) return null
    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.globalAlpha = clamp01(watermark.opacity / 100)
    const margin = Math.round((watermark.marginPercent / 100) * Math.min(outputWidth, outputHeight))
    if (watermark.mode === 'text') {
        const content = watermark.text.trim()
        if (!content) return null
        const fontPx = Math.max(1, Math.round((watermark.sizePercent / 100) * outputHeight))
        ctx.font = `600 ${fontPx}px -apple-system, "Segoe UI", system-ui, sans-serif`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = '#ffffff'
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
        ctx.shadowBlur = Math.max(2, Math.round(fontPx * 0.08))
        const metrics = ctx.measureText(content)
        const ascent = metrics.actualBoundingBoxAscent || fontPx * 0.8
        const descent = metrics.actualBoundingBoxDescent || fontPx * 0.2
        const { x, y } = placeBox(watermark.position, outputWidth, outputHeight, metrics.width, ascent + descent, margin)
        ctx.fillText(content, x, y + ascent)
    } else {
        if (!image) return null
        const boxWidth = Math.max(1, Math.round((watermark.sizePercent / 100) * outputWidth))
        const boxHeight = Math.max(1, Math.round(boxWidth * (image.height / image.width)))
        const { x, y } = placeBox(watermark.position, outputWidth, outputHeight, boxWidth, boxHeight, margin)
        ctx.drawImage(image, x, y, boxWidth, boxHeight)
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((result) => resolve(result), 'image/png'))
    if (!blob) return null
    return new Uint8Array(await blob.arrayBuffer())
}
