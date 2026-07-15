import { REC2020_TO_SRGB } from './colorSpaces'
import { createExportEngine } from './exportRenderer'
import { floatToHalf } from './half'
import type { ExportSource } from './exportRenderer'
import type { EditState } from '../types/EditState'
import type { LensProfileMatch } from '../types/LensProfileMatch'

const CLIPBOARD_MAX_EDGE = 4096

const halfToFloat = (bits: number) => {
    const sign = (bits & 0x8000) >> 15 ? -1 : 1
    const exponent = (bits & 0x7c00) >> 10
    const fraction = bits & 0x03ff
    if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024)
    if (exponent === 0x1f) return fraction ? NaN : sign * Infinity
    return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024)
}

const encodeOetf = (value: number) => {
    const x = value < 0 ? 0 : value > 1 ? 1 : value
    return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
}

const toByte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)))

const downscaleSource = (source: ExportSource, maxEdge: number): ExportSource => {
    const longEdge = Math.max(source.width, source.height)
    if (longEdge <= maxEdge) return source
    const scale = maxEdge / longEdge
    const targetW = Math.max(1, Math.round(source.width * scale))
    const targetH = Math.max(1, Math.round(source.height * scale))
    const { width: sw, height: sh, data } = source
    const out = new Uint16Array(targetW * targetH * 3)
    for (let ty = 0; ty < targetH; ty++) {
        const sy0 = Math.floor((ty * sh) / targetH)
        const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) * sh) / targetH))
        for (let tx = 0; tx < targetW; tx++) {
            const sx0 = Math.floor((tx * sw) / targetW)
            const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) * sw) / targetW))
            let r = 0
            let g = 0
            let b = 0
            let count = 0
            for (let sy = sy0; sy < sy1; sy++) {
                const rowBase = sy * sw * 3
                for (let sx = sx0; sx < sx1; sx++) {
                    const idx = rowBase + sx * 3
                    r += halfToFloat(data[idx])
                    g += halfToFloat(data[idx + 1])
                    b += halfToFloat(data[idx + 2])
                    count++
                }
            }
            const outIdx = (ty * targetW + tx) * 3
            out[outIdx] = floatToHalf(r / count)
            out[outIdx + 1] = floatToHalf(g / count)
            out[outIdx + 2] = floatToHalf(b / count)
        }
    }
    return { width: targetW, height: targetH, data: out, colorMatrix: source.colorMatrix, flip: source.flip }
}

const canvasToPng = (canvas: HTMLCanvasElement) =>
    new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png'))

export const renderClipboardPng = async (
    source: ExportSource,
    state: EditState,
    lensProfile: LensProfileMatch | null,
    maxEdge = CLIPBOARD_MAX_EDGE,
) => {
    const scaled = downscaleSource(source, maxEdge)
    const engine = createExportEngine()
    try {
        const job = engine.prepare(scaled, state, lensProfile)
        const canvas = document.createElement('canvas')
        canvas.width = job.width
        canvas.height = job.height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2d context unavailable')
        const image = ctx.createImageData(job.width, job.height)
        const m = REC2020_TO_SRGB
        await job.stream(
            async (tile) => {
                for (let row = 0; row < tile.height; row++) {
                    const destBase = ((tile.y + row) * job.width + tile.x) * 4
                    const srcBase = row * tile.width * 4
                    for (let col = 0; col < tile.width; col++) {
                        const s = srcBase + col * 4
                        const lr = halfToFloat(tile.data[s])
                        const lg = halfToFloat(tile.data[s + 1])
                        const lb = halfToFloat(tile.data[s + 2])
                        const sr = m[0] * lr + m[1] * lg + m[2] * lb
                        const sg = m[3] * lr + m[4] * lg + m[5] * lb
                        const sb = m[6] * lr + m[7] * lg + m[8] * lb
                        const d = destBase + col * 4
                        image.data[d] = toByte(encodeOetf(sr))
                        image.data[d + 1] = toByte(encodeOetf(sg))
                        image.data[d + 2] = toByte(encodeOetf(sb))
                        image.data[d + 3] = 255
                    }
                }
            },
            () => false,
        )
        job.release()
        ctx.putImageData(image, 0, 0)
        return await canvasToPng(canvas)
    } finally {
        engine.dispose()
    }
}
