import { describe, expect, test } from 'bun:test'
import { drawerPointToLocal } from './drawer-coordinates'

describe('레이어 포인터 좌표', () => {
    test('이동과 확대된 레이어의 역변환을 적용합니다', () => {
        const point = drawerPointToLocal([0.8, 0.7], { offsetX: 10, offsetY: 20, scale: 200, rotate: 0 }, 800, 400)
        expect(point[0]).toBeCloseTo(0.6)
        expect(point[1]).toBeCloseTo(0.5)
    })
    test('비정방형 사진의 레이어 회전을 픽셀 비율로 되돌립니다', () => {
        const point = drawerPointToLocal([0.5, 1], { offsetX: 0, offsetY: 0, scale: 100, rotate: 90 }, 800, 400)
        expect(point[0]).toBeCloseTo(0.75)
        expect(point[1]).toBeCloseTo(0.5)
    })
})
