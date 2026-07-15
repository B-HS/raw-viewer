import { toColumnMajor } from './colorSpaces'
import type { GeometryState } from '../types/GeometryState'

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]

const multiply = (a: number[], b: number[]) => {
    const out = new Array<number>(9)
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            out[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[col + 3] + a[row * 3 + 2] * b[col + 6]
        }
    }
    return out
}

const invert = (m: number[]) => {
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
    if (Math.abs(det) < 1e-9) return IDENTITY.slice()
    const inv = 1 / det
    return [
        (m[4] * m[8] - m[5] * m[7]) * inv,
        (m[2] * m[7] - m[1] * m[8]) * inv,
        (m[1] * m[5] - m[2] * m[4]) * inv,
        (m[5] * m[6] - m[3] * m[8]) * inv,
        (m[0] * m[8] - m[2] * m[6]) * inv,
        (m[2] * m[3] - m[0] * m[5]) * inv,
        (m[3] * m[7] - m[4] * m[6]) * inv,
        (m[1] * m[6] - m[0] * m[7]) * inv,
        (m[0] * m[4] - m[1] * m[3]) * inv,
    ]
}

export const isGeometryNeutral = (geometry: GeometryState) =>
    !geometry.flipH &&
    !geometry.flipV &&
    geometry.straighten === 0 &&
    geometry.perspectiveV === 0 &&
    geometry.perspectiveH === 0 &&
    geometry.perspectiveRotate === 0 &&
    geometry.aspectAdjust === 0 &&
    geometry.scale === 100 &&
    geometry.offsetX === 0 &&
    geometry.offsetY === 0

export const buildGeometryWarp = (geometry: GeometryState) => {
    const base = geometry.scale / 100
    const skew = geometry.aspectAdjust / 200
    const scaleX = base * (1 + skew) * (geometry.flipH ? -1 : 1)
    const scaleY = base * (1 - skew) * (geometry.flipV ? -1 : 1)
    const scale = [scaleX, 0, 0, 0, scaleY, 0, 0, 0, 1]

    const angle = ((geometry.straighten + geometry.perspectiveRotate * 0.45) * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rotate = [cos, -sin, 0, sin, cos, 0, 0, 0, 1]

    const perspective = [1, 0, 0, 0, 1, 0, (geometry.perspectiveH / 100) * 0.5, (geometry.perspectiveV / 100) * 0.5, 1]

    const translate = [1, 0, (geometry.offsetX / 100) * 0.5, 0, 1, (geometry.offsetY / 100) * 0.5, 0, 0, 1]

    const forward = multiply(translate, multiply(perspective, multiply(rotate, scale)))
    return toColumnMajor(invert(forward))
}
