import { describe, expect, test } from 'bun:test'
import { composeFlip, dispDims } from './viewTransform'

describe('composeFlip', () => {
    test('회전 없음은 원본 flip 을 유지한다', () => {
        expect(composeFlip(0, 0)).toBe(0)
        expect(composeFlip(3, 0)).toBe(3)
        expect(composeFlip(5, 0)).toBe(5)
        expect(composeFlip(6, 0)).toBe(6)
    })

    test('중립 방향에서 시계방향 90도 단위 회전을 flip 코드로 변환한다', () => {
        expect(composeFlip(0, 1)).toBe(6)
        expect(composeFlip(0, 2)).toBe(3)
        expect(composeFlip(0, 3)).toBe(5)
    })

    test('EXIF 방향과 사용자 회전을 합성한다', () => {
        expect(composeFlip(5, 1)).toBe(0)
        expect(composeFlip(6, 1)).toBe(3)
        expect(composeFlip(3, 2)).toBe(0)
        expect(composeFlip(6, 3)).toBe(0)
        expect(composeFlip(5, 2)).toBe(6)
    })

    test('4회 회전하면 원래 방향으로 돌아온다', () => {
        for (const flip of [0, 3, 5, 6]) {
            let current = flip
            for (let i = 0; i < 4; i++) current = composeFlip(current, 1)
            expect(current).toBe(flip)
        }
    })

    test('합성된 flip 은 dispDims 에서 가로세로를 올바르게 교환한다', () => {
        expect(dispDims(6000, 4000, composeFlip(0, 1))).toEqual({ dispW: 4000, dispH: 6000 })
        expect(dispDims(6000, 4000, composeFlip(0, 2))).toEqual({ dispW: 6000, dispH: 4000 })
        expect(dispDims(6000, 4000, composeFlip(5, 1))).toEqual({ dispW: 6000, dispH: 4000 })
    })
})
