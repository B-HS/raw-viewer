import { packHalfArray } from './half'
import type { CurvePoint } from '../types/CurvePoint'
import type { CurvesState } from '../types/CurvesState'

export const TONE_LUT_SIZE = 1024

const isIdentity = (points: CurvePoint[]) => points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1

const sampleMonotone = (points: CurvePoint[], out: Float32Array, channel: number, stride: number) => {
    const sorted = [...points].sort((a, b) => a.x - b.x)
    const count = sorted.length
    if (count < 2 || isIdentity(sorted)) {
        for (let i = 0; i < TONE_LUT_SIZE; i++) out[i * stride + channel] = i / (TONE_LUT_SIZE - 1)
        return
    }
    const xs = sorted.map((p) => p.x)
    const ys = sorted.map((p) => p.y)
    const secant = new Array<number>(count - 1)
    for (let i = 0; i < count - 1; i++) {
        const dx = xs[i + 1] - xs[i]
        secant[i] = dx > 1e-6 ? (ys[i + 1] - ys[i]) / dx : 0
    }
    const slope = new Array<number>(count)
    slope[0] = secant[0]
    slope[count - 1] = secant[count - 2]
    for (let i = 1; i < count - 1; i++) slope[i] = (secant[i - 1] + secant[i]) / 2
    for (let i = 0; i < count - 1; i++) {
        if (secant[i] === 0) {
            slope[i] = 0
            slope[i + 1] = 0
            continue
        }
        const alpha = slope[i] / secant[i]
        const beta = slope[i + 1] / secant[i]
        const magnitude = alpha * alpha + beta * beta
        if (magnitude > 9) {
            const tau = 3 / Math.sqrt(magnitude)
            slope[i] = tau * alpha * secant[i]
            slope[i + 1] = tau * beta * secant[i]
        }
    }
    let segment = 0
    for (let i = 0; i < TONE_LUT_SIZE; i++) {
        const x = i / (TONE_LUT_SIZE - 1)
        while (segment < count - 2 && x > xs[segment + 1]) segment++
        const width = xs[segment + 1] - xs[segment]
        const t = width > 1e-6 ? (x - xs[segment]) / width : 0
        const t2 = t * t
        const t3 = t2 * t
        const h00 = 2 * t3 - 3 * t2 + 1
        const h10 = t3 - 2 * t2 + t
        const h01 = -2 * t3 + 3 * t2
        const h11 = t3 - t2
        const y = h00 * ys[segment] + h10 * width * slope[segment] + h01 * ys[segment + 1] + h11 * width * slope[segment + 1]
        out[i * stride + channel] = Math.min(1, Math.max(0, y))
    }
}

export const isCurvesNeutral = (curves: CurvesState) =>
    isIdentity(curves.rgb) && isIdentity(curves.red) && isIdentity(curves.green) && isIdentity(curves.blue)

export const buildToneCurveLut = (curves: CurvesState) => {
    const values = new Float32Array(TONE_LUT_SIZE * 4)
    sampleMonotone(curves.red, values, 0, 4)
    sampleMonotone(curves.green, values, 1, 4)
    sampleMonotone(curves.blue, values, 2, 4)
    sampleMonotone(curves.rgb, values, 3, 4)
    return packHalfArray(values)
}
