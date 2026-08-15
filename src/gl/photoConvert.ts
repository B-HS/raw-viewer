import { REC2020_TO_SRGB } from './colorSpaces'
import { halfToFloat } from './half'

const RGBA_CHANNELS = 4

const BYTE_MAX = 255

const encodeOetf = (value: number) => {
    const x = value < 0 ? 0 : value > 1 ? 1 : value
    return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
}

/**
 * Converts linear Rec.2020 RGBA float pixels to display-ready sRGB bytes
 * (straight alpha, alpha forced opaque).
 */
export const floatRgbaToSrgbBytes = (data: Float32Array, pixelCount: number) => {
    const out = new Uint8ClampedArray(pixelCount * RGBA_CHANNELS)
    const m = REC2020_TO_SRGB
    for (let pixel = 0; pixel < pixelCount; pixel++) {
        const index = pixel * RGBA_CHANNELS
        const r = data[index]
        const g = data[index + 1]
        const b = data[index + 2]
        out[index] = encodeOetf(m[0] * r + m[1] * g + m[2] * b) * BYTE_MAX
        out[index + 1] = encodeOetf(m[3] * r + m[4] * g + m[5] * b) * BYTE_MAX
        out[index + 2] = encodeOetf(m[6] * r + m[7] * g + m[8] * b) * BYTE_MAX
        out[index + 3] = BYTE_MAX
    }
    return out
}

/**
 * Same as floatRgbaToSrgbBytes for half-float (f16 bit pattern) RGBA input.
 */
export const halfRgbaToSrgbBytes = (data: Uint16Array, pixelCount: number) => {
    const out = new Uint8ClampedArray(pixelCount * RGBA_CHANNELS)
    const m = REC2020_TO_SRGB
    for (let pixel = 0; pixel < pixelCount; pixel++) {
        const index = pixel * RGBA_CHANNELS
        const r = halfToFloat(data[index])
        const g = halfToFloat(data[index + 1])
        const b = halfToFloat(data[index + 2])
        out[index] = encodeOetf(m[0] * r + m[1] * g + m[2] * b) * BYTE_MAX
        out[index + 1] = encodeOetf(m[3] * r + m[4] * g + m[5] * b) * BYTE_MAX
        out[index + 2] = encodeOetf(m[6] * r + m[7] * g + m[8] * b) * BYTE_MAX
        out[index + 3] = BYTE_MAX
    }
    return out
}
