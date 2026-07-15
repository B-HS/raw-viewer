export type ImagePoint = { u: number; v: number }

export type CanvasPoint = { x: number; y: number }

export const flipDegrees = (flip: number) => (flip === 3 ? 180 : flip === 5 ? -90 : flip === 6 ? 90 : 0)

export const uvToCanvas = (model: Float32Array, clientW: number, clientH: number, u: number, v: number): CanvasPoint => {
    const posX = 2 * u - 1
    const posY = 1 - 2 * v
    const ndcX = model[0] * posX + model[3] * posY + model[6]
    const ndcY = model[1] * posX + model[4] * posY + model[7]
    return { x: ((ndcX + 1) / 2) * clientW, y: ((1 - ndcY) / 2) * clientH }
}

export const canvasToUv = (model: Float32Array, clientW: number, clientH: number, x: number, y: number): ImagePoint | null => {
    const ndcX = (2 * x) / clientW - 1
    const ndcY = 1 - (2 * y) / clientH
    const a = model[0]
    const b = model[1]
    const c = model[3]
    const d = model[4]
    const det = a * d - b * c
    if (Math.abs(det) < 1e-9) return null
    const rx = ndcX - model[6]
    const ry = ndcY - model[7]
    const posX = (d * rx - c * ry) / det
    const posY = (-b * rx + a * ry) / det
    const u = posX * 0.5 + 0.5
    const v = (1 - posY) * 0.5
    if (u < 0 || u > 1 || v < 0 || v > 1) return null
    return { u, v }
}
