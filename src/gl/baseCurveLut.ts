import type { BaseCurveMode } from '../types/BaseCurveMode'

const CONTROL: Record<BaseCurveMode, { x: number[]; y: number[] }> = {
    linear: { x: [0, 1], y: [0, 1] },
    standard: { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.22, 0.5, 0.78, 1] },
    filmic: { x: [0, 0.2, 0.5, 0.8, 1], y: [0, 0.12, 0.5, 0.86, 0.98] },
    'camera-match': { x: [0, 0.25, 0.5, 0.75, 1], y: [0, 0.22, 0.5, 0.78, 1] },
}

export const buildBaseCurveLut = (samples = 256, mode: BaseCurveMode = 'standard') => {
    const controlX = CONTROL[mode].x
    const controlY = CONTROL[mode].y
    const count = controlX.length
    const lut = new Uint8Array(samples)
    if (count < 2) {
        for (let i = 0; i < samples; i++) lut[i] = Math.round((i / (samples - 1)) * 255)
        return lut
    }

    const secant: number[] = []
    for (let i = 0; i < count - 1; i++) secant[i] = (controlY[i + 1] - controlY[i]) / (controlX[i + 1] - controlX[i])

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
    for (let i = 0; i < samples; i++) {
        const x = i / (samples - 1)
        while (segment < count - 2 && x > controlX[segment + 1]) segment++
        const width = controlX[segment + 1] - controlX[segment]
        const t = (x - controlX[segment]) / width
        const t2 = t * t
        const t3 = t2 * t
        const h00 = 2 * t3 - 3 * t2 + 1
        const h10 = t3 - 2 * t2 + t
        const h01 = -2 * t3 + 3 * t2
        const h11 = t3 - t2
        const y = h00 * controlY[segment] + h10 * width * slope[segment] + h01 * controlY[segment + 1] + h11 * width * slope[segment + 1]
        lut[i] = Math.round(Math.min(1, Math.max(0, y)) * 255)
    }
    return lut
}
