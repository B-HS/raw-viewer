import type { ScanState } from '../types/ScanState'

type Vec2 = readonly [number, number]

const isScanApplied = (scan: ScanState | null | undefined) => scan?.enabled === true

const edgeLength = (a: Vec2, b: Vec2, width: number, height: number) => Math.hypot((a[0] - b[0]) * width, (a[1] - b[1]) * height)

export const scanOutputDims = (width: number, height: number, scan: ScanState | null | undefined) => {
    if (!scan || !isScanApplied(scan)) return { w: width, h: height }
    const [tl, tr, br, bl] = scan.corners
    const w = Math.max(1, Math.round((edgeLength(tl, tr, width, height) + edgeLength(bl, br, width, height)) / 2))
    const h = Math.max(1, Math.round((edgeLength(tl, bl, width, height) + edgeLength(tr, br, width, height)) / 2))
    return { w, h }
}

export const scanCornerArray = (scan: ScanState) => new Float32Array(scan.corners.flat())

export const scanEdgeArray = (scan: ScanState) => new Float32Array(scan.edges.flat())

/**
 * Derives the quadratic Bezier control point from an on-curve midpoint handle,
 * so that the curve passes through the handle at t = 0.5.
 */
export const qbezControl = (a: Vec2, mid: Vec2, b: Vec2) => [2 * mid[0] - 0.5 * (a[0] + b[0]), 2 * mid[1] - 0.5 * (a[1] + b[1])] as const

const qbez = (a: Vec2, mid: Vec2, b: Vec2, t: number) => {
    const control = qbezControl(a, mid, b)
    const s = 1 - t
    return [s * s * a[0] + 2 * s * t * control[0] + t * t * b[0], s * s * a[1] + 2 * s * t * control[1] + t * t * b[1]] as const
}

/**
 * Reference implementation of the shader-side Coons patch mapping:
 * rectified output (u, v) in [0,1]^2 to source-normalized coordinates.
 */
export const scanCoonsPoint = (scan: ScanState, u: number, v: number) => {
    const [tl, tr, br, bl] = scan.corners
    const [top, right, bottom, left] = scan.edges
    const topPoint = qbez(tl, top, tr, u)
    const bottomPoint = qbez(bl, bottom, br, u)
    const leftPoint = qbez(tl, left, bl, v)
    const rightPoint = qbez(tr, right, br, v)
    const cornerX = (1 - u) * (1 - v) * tl[0] + u * (1 - v) * tr[0] + (1 - u) * v * bl[0] + u * v * br[0]
    const cornerY = (1 - u) * (1 - v) * tl[1] + u * (1 - v) * tr[1] + (1 - u) * v * bl[1] + u * v * br[1]
    return [
        (1 - v) * topPoint[0] + v * bottomPoint[0] + (1 - u) * leftPoint[0] + u * rightPoint[0] - cornerX,
        (1 - v) * topPoint[1] + v * bottomPoint[1] + (1 - u) * leftPoint[1] + u * rightPoint[1] - cornerY,
    ] as const
}
