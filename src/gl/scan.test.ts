import { describe, expect, test } from 'bun:test'
import { scanCoonsPoint, scanOutputDims } from './scan'
import type { ScanState } from '../types/ScanState'

const fullFrame: ScanState = {
    enabled: true,
    corners: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
    ],
    edges: [
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0, 0.5],
    ],
}

const halfQuad: ScanState = {
    enabled: true,
    corners: [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.75, 0.75],
        [0.25, 0.75],
    ],
    edges: [
        [0.5, 0.25],
        [0.75, 0.5],
        [0.5, 0.75],
        [0.25, 0.5],
    ],
}

describe('scanCoonsPoint', () => {
    test('풀프레임 사각형 + 직선 엣지는 항등 매핑이다', () => {
        for (const [u, v] of [
            [0.1, 0.2],
            [0.5, 0.5],
            [0.9, 0.3],
            [0.33, 0.77],
        ]) {
            const [x, y] = scanCoonsPoint(fullFrame, u, v)
            expect(x).toBeCloseTo(u, 6)
            expect(y).toBeCloseTo(v, 6)
        }
    })

    test('출력 모서리는 지정한 꼭지점으로 사상된다', () => {
        expect(scanCoonsPoint(halfQuad, 0, 0)).toEqual([0.25, 0.25])
        expect(scanCoonsPoint(halfQuad, 1, 0)).toEqual([0.75, 0.25])
        expect(scanCoonsPoint(halfQuad, 1, 1)).toEqual([0.75, 0.75])
        expect(scanCoonsPoint(halfQuad, 0, 1)).toEqual([0.25, 0.75])
    })

    test('엣지 중점 핸들은 곡선 위 t=0.5 지점을 통과한다', () => {
        const curled: ScanState = { ...halfQuad, edges: [[0.5, 0.15], ...halfQuad.edges.slice(1)] as ScanState['edges'] }
        const [x, y] = scanCoonsPoint(curled, 0.5, 0)
        expect(x).toBeCloseTo(0.5, 6)
        expect(y).toBeCloseTo(0.15, 6)
    })
})

describe('scanOutputDims', () => {
    test('비활성/부재 시 원본 치수를 유지한다', () => {
        expect(scanOutputDims(6000, 4000, null)).toEqual({ w: 6000, h: 4000 })
        expect(scanOutputDims(6000, 4000, { ...fullFrame, enabled: false })).toEqual({ w: 6000, h: 4000 })
    })

    test('풀프레임 사각형은 원본 치수와 같다', () => {
        expect(scanOutputDims(6000, 4000, fullFrame)).toEqual({ w: 6000, h: 4000 })
    })

    test('절반 크기 사각형은 절반 치수를 낸다', () => {
        expect(scanOutputDims(6000, 4000, halfQuad)).toEqual({ w: 3000, h: 2000 })
    })
})
