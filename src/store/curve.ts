import type { CurvePoint } from '../types/CurvePoint'

export const MAX_CURVE_POINTS = 16

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

const isIdentity = (points: CurvePoint[]) => points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1

export const sortCurve = (points: CurvePoint[]) => [...points].sort((a, b) => a.x - b.x)

export const sampleMonotoneCurve = (points: CurvePoint[], count: number) => {
    const out = new Float32Array(count)
    const sorted = sortCurve(points)
    const n = sorted.length
    if (n < 2 || isIdentity(sorted)) {
        for (let i = 0; i < count; i++) out[i] = i / (count - 1)
        return out
    }
    const xs = sorted.map((point) => point.x)
    const ys = sorted.map((point) => point.y)
    const secant = new Array<number>(n - 1)
    for (let i = 0; i < n - 1; i++) {
        const dx = xs[i + 1] - xs[i]
        secant[i] = dx > 1e-6 ? (ys[i + 1] - ys[i]) / dx : 0
    }
    const slope = new Array<number>(n)
    slope[0] = secant[0]
    slope[n - 1] = secant[n - 2]
    for (let i = 1; i < n - 1; i++) slope[i] = (secant[i - 1] + secant[i]) / 2
    for (let i = 0; i < n - 1; i++) {
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
    for (let i = 0; i < count; i++) {
        const x = i / (count - 1)
        while (segment < n - 2 && x > xs[segment + 1]) segment++
        const width = xs[segment + 1] - xs[segment]
        const t = width > 1e-6 ? (x - xs[segment]) / width : 0
        const t2 = t * t
        const t3 = t2 * t
        const h00 = 2 * t3 - 3 * t2 + 1
        const h10 = t3 - 2 * t2 + t
        const h01 = -2 * t3 + 3 * t2
        const h11 = t3 - t2
        const y = h00 * ys[segment] + h10 * width * slope[segment] + h01 * ys[segment + 1] + h11 * width * slope[segment + 1]
        out[i] = clamp01(y)
    }
    return out
}
