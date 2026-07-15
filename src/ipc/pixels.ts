import type { ProxyLevel } from '../types/ProxyLevel'

export const aetherUrl = (path: string) => {
    const isWindows = navigator.userAgent.includes('Windows')
    return isWindows ? `http://aether.localhost/${path}` : `aether://localhost/${path}`
}

export type PixelData = { kind: 'jpeg'; blob: Blob } | { kind: 'aeth'; width: number; height: number; data: Uint16Array }

const AETH_MAGIC = 'AETH'
const AETH_HEADER_BYTES = 16
const AETH_FORMAT_F16 = 2
const AETH_FORMAT_U8 = 0
const AETH_CHANNELS_RGB = 3
const AETH_CHANNELS_RGBA = 4

export const fetchPixels = async (imageId: string, level: ProxyLevel, rev: number, signal: AbortSignal) => {
    const response = await fetch(aetherUrl(`pixels/${imageId}/${level}?rev=${rev}`), { signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`pixels ${imageId} ${level} ${response.status}`)
    const buffer = await response.arrayBuffer()

    if (level === 'l0') return { kind: 'jpeg' as const, blob: new Blob([buffer], { type: 'image/jpeg' }) }

    const view = new DataView(buffer)
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    if (magic !== AETH_MAGIC) throw new Error(`bad AETH magic ${magic}`)
    const width = view.getUint32(4, true)
    const height = view.getUint32(8, true)
    const format = view.getUint8(12)
    const channels = view.getUint8(13)
    if (format !== AETH_FORMAT_F16) throw new Error(`unexpected AETH format ${format}`)
    if (channels !== AETH_CHANNELS_RGB) throw new Error(`unexpected AETH channels ${channels}`)
    const data = new Uint16Array(buffer, AETH_HEADER_BYTES, width * height * AETH_CHANNELS_RGB)
    return { kind: 'aeth' as const, width, height, data }
}

export const fetchCpuFrame = async (imageId: string, rev: number, signal?: AbortSignal) => {
    const response = await fetch(aetherUrl(`pixels/${imageId}/cpu?rev=${rev}`), { signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`cpu frame ${imageId} ${response.status}`)
    const buffer = await response.arrayBuffer()
    const view = new DataView(buffer)
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    if (magic !== AETH_MAGIC) throw new Error(`bad AETH magic ${magic}`)
    const width = view.getUint32(4, true)
    const height = view.getUint32(8, true)
    const format = view.getUint8(12)
    const channels = view.getUint8(13)
    if (format !== AETH_FORMAT_U8) throw new Error(`unexpected CPU AETH format ${format}`)
    if (channels !== AETH_CHANNELS_RGBA) throw new Error(`unexpected CPU AETH channels ${channels}`)
    const length = width * height * AETH_CHANNELS_RGBA
    const data = new Uint8ClampedArray(buffer.slice(AETH_HEADER_BYTES, AETH_HEADER_BYTES + length))
    return { width, height, data }
}
