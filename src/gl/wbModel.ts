import type { WbState } from '../types/WbState'

export const WB_REFERENCE_KELVIN = 6500
export const WB_MIN_KELVIN = 2000
export const WB_MAX_KELVIN = 50000

const WARMTH_STRENGTH = 0.3
const TINT_STRENGTH = 0.5

const clamp = (value: number, lo: number, hi: number) => (value < lo ? lo : value > hi ? hi : value)

export const gainsFromTempTint = (temp: number, tint: number, tempShift: number | null): [number, number, number] => {
    const warmth = tempShift != null ? (tempShift / 100) * 1.5 : Math.log2(clamp(temp, WB_MIN_KELVIN, WB_MAX_KELVIN) / WB_REFERENCE_KELVIN)
    const red = Math.pow(2, WARMTH_STRENGTH * warmth)
    const blue = Math.pow(2, -WARMTH_STRENGTH * warmth)
    const green = Math.pow(2, (-tint / 150) * TINT_STRENGTH)
    return [red, green, blue]
}

export const wbGainsFromState = (wb: WbState): [number, number, number] => gainsFromTempTint(wb.temp, wb.tint, wb.tempShift)

export const tempTintFromGains = (gains: [number, number, number]) => {
    const [red, green, blue] = gains
    const safeRed = red > 1e-6 ? red : 1e-6
    const safeGreen = green > 1e-6 ? green : 1e-6
    const safeBlue = blue > 1e-6 ? blue : 1e-6
    const warmth = Math.log2(safeRed / safeBlue) / (2 * WARMTH_STRENGTH)
    const temp = clamp(WB_REFERENCE_KELVIN * Math.pow(2, warmth), WB_MIN_KELVIN, WB_MAX_KELVIN)
    const achromatic = Math.sqrt(safeRed * safeBlue)
    const tint = clamp((-150 / TINT_STRENGTH) * Math.log2(safeGreen / achromatic), -150, 150)
    return { temp: Math.round(temp), tint: Math.round(tint) }
}
