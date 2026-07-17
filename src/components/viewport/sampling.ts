import { REC2020_TO_SRGB } from '../../gl/colorSpaces'
import { HSL_BANDS } from '../../store/editDefaults'
import type { HslBand } from '../../types/HslBand'

const BAND_CENTER: Record<HslBand, number> = {
    red: 0,
    orange: 30,
    yellow: 60,
    green: 120,
    aqua: 180,
    blue: 240,
    purple: 280,
    magenta: 320,
}

export const hueDegrees = (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    if (delta <= 0) return 0
    let hue: number
    if (max === r) hue = ((g - b) / delta) % 6
    else if (max === g) hue = (b - r) / delta + 2
    else hue = (r - g) / delta + 4
    hue *= 60
    return hue < 0 ? hue + 360 : hue
}

const angularDistance = (a: number, b: number) => {
    const d = Math.abs(a - b)
    return Math.min(d, 360 - d)
}

export const nearestBand = (degrees: number) => {
    let best = HSL_BANDS[0]
    let bestDist = Infinity
    for (const band of HSL_BANDS) {
        const dist = angularDistance(degrees, BAND_CENTER[band])
        if (dist < bestDist) {
            bestDist = dist
            best = band
        }
    }
    return best
}

const srgbOetf = (value: number) => {
    const c = value < 0 ? 0 : value > 1 ? 1 : value
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

export const rec2020LinearToSrgb = (r: number, g: number, b: number): [number, number, number] => {
    const m = REC2020_TO_SRGB
    return [srgbOetf(m[0] * r + m[1] * g + m[2] * b), srgbOetf(m[3] * r + m[4] * g + m[5] * b), srgbOetf(m[6] * r + m[7] * g + m[8] * b)]
}
