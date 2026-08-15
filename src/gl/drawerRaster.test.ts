import { describe, expect, test } from 'bun:test'
import {
    adjustPixels,
    arrowHeadPoints,
    drawerNeedsPhoto,
    drawerRasterDims,
    drawerSizePx,
    floodFillData,
    hasDrawerContent,
    hexToRgb,
} from './drawerRaster'
import type { DrawerState } from '../types/DrawerState'

const layer = (visible: boolean, objectCount: number) => ({
    id: 'layer-1',
    name: 'Layer 1',
    visible,
    opacity: 100,
    objects: Array.from({ length: objectCount }, () => ({
        kind: 'stroke' as const,
        tool: 'brush' as const,
        color: '#ff0000',
        size: 2,
        opacity: 100,
        points: [[0.5, 0.5]] as [number, number][],
        clip: null,
    })),
    blend: 'normal' as const,
    transform: null,
    adjust: null,
})

describe('hasDrawerContent', () => {
    test('레이어가 없거나 비어 있으면 false', () => {
        expect(hasDrawerContent(null)).toBe(false)
        expect(hasDrawerContent({ layers: [] })).toBe(false)
        expect(hasDrawerContent({ layers: [layer(true, 0)] })).toBe(false)
    })

    test('숨김 레이어만 있으면 false, 표시 레이어에 오브젝트가 있으면 true', () => {
        expect(hasDrawerContent({ layers: [layer(false, 3)] })).toBe(false)
        expect(hasDrawerContent({ layers: [layer(false, 3), layer(true, 1)] } as DrawerState)).toBe(true)
    })
})

describe('drawerSizePx', () => {
    test('긴 변 대비 퍼센트로 환산하고 최소 1px 을 보장한다', () => {
        expect(drawerSizePx(2, 6000, 4000)).toBe(120)
        expect(drawerSizePx(0.001, 100, 100)).toBe(1)
    })
})

describe('drawerRasterDims', () => {
    test('최대 변 이내면 원본 유지, 초과하면 비율 유지 축소', () => {
        expect(drawerRasterDims(2000, 1000)).toEqual({ w: 2000, h: 1000 })
        expect(drawerRasterDims(8192, 4096)).toEqual({ w: 4096, h: 2048 })
    })
})

describe('arrowHeadPoints', () => {
    test('머리 양쪽 점은 끝점에서 같은 거리에 있다', () => {
        const [left, right] = arrowHeadPoints([0, 0], [100, 0], 10)
        const distanceLeft = Math.hypot(left[0] - 100, left[1])
        const distanceRight = Math.hypot(right[0] - 100, right[1])
        expect(distanceLeft).toBeCloseTo(10, 6)
        expect(distanceRight).toBeCloseTo(10, 6)
        expect(left[1]).toBeCloseTo(-right[1], 6)
    })
})

describe('hexToRgb', () => {
    test('16진 색상을 파싱하고 잘못된 입력은 검정으로 처리한다', () => {
        expect(hexToRgb('#ff8000')).toEqual([255, 128, 0])
        expect(hexToRgb('#000000')).toEqual([0, 0, 0])
        expect(hexToRgb('oops')).toEqual([0, 0, 0])
    })
})

describe('drawerNeedsPhoto', () => {
    test('복제/블러 오브젝트가 있을 때만 true', () => {
        expect(drawerNeedsPhoto({ layers: [layer(true, 1)] } as DrawerState)).toBe(false)
        const withClone: DrawerState = {
            layers: [
                {
                    ...layer(true, 0),
                    objects: [{ kind: 'clone', points: [[0.5, 0.5]], offset: [0.1, 0], size: 3, clip: null }],
                },
            ],
        }
        expect(drawerNeedsPhoto(withClone)).toBe(true)
        const hidden: DrawerState = { layers: [{ ...withClone.layers[0], visible: false }] }
        expect(drawerNeedsPhoto(hidden)).toBe(false)
    })
})

const grid4 = () => {
    const width = 4
    const height = 4
    const data = new Uint8ClampedArray(width * height * 4)
    const paint = (x: number, y: number, rgba: [number, number, number, number]) => data.set(rgba, (y * width + x) * 4)
    return { data, width, height, paint }
}

describe('floodFillData', () => {
    test('경계 픽셀에 막힌 연결 영역만 채운다', () => {
        const { data, width, height, paint } = grid4()
        for (let y = 0; y < height; y++) paint(2, y, [255, 255, 255, 255])
        expect(floodFillData({ data, width, height }, 0, 0, [255, 0, 0])).toBe(true)
        const pixel = (x: number, y: number) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)]
        expect(pixel(0, 0)).toEqual([255, 0, 0, 255])
        expect(pixel(1, 3)).toEqual([255, 0, 0, 255])
        expect(pixel(2, 0)).toEqual([255, 255, 255, 255])
        expect(pixel(3, 0)).toEqual([0, 0, 0, 0])
    })

    test('마스크가 있으면 마스크 내부만 채운다', () => {
        const { data, width, height } = grid4()
        const mask = new Uint8Array(width * height)
        mask[0] = 1
        mask[1] = 1
        expect(floodFillData({ data, width, height }, 0, 0, [0, 255, 0], mask)).toBe(true)
        expect([...data.slice(0, 4)]).toEqual([0, 255, 0, 255])
        expect([...data.slice(4, 8)]).toEqual([0, 255, 0, 255])
        expect([...data.slice(8, 12)]).toEqual([0, 0, 0, 0])
    })

    test('시드가 이미 채움 색이면 아무것도 하지 않는다', () => {
        const { data, width, height, paint } = grid4()
        paint(0, 0, [255, 0, 0, 255])
        expect(floodFillData({ data, width, height }, 0, 0, [255, 0, 0])).toBe(false)
    })
})

describe('adjustPixels', () => {
    const pixel = (rgba: [number, number, number, number]) => new Uint8ClampedArray(rgba)

    test('중립 보정은 픽셀을 바꾸지 않는다', () => {
        const data = pixel([120, 60, 200, 255])
        adjustPixels(data, { brightness: 0, contrast: 0, saturation: 0, hue: 0 })
        expect([...data]).toEqual([120, 60, 200, 255])
    })

    test('채도 -100 은 무채색으로 만든다', () => {
        const data = pixel([200, 40, 90, 255])
        adjustPixels(data, { brightness: 0, contrast: 0, saturation: -100, hue: 0 })
        expect(data[0]).toBe(data[1])
        expect(data[1]).toBe(data[2])
    })

    test('밝기 +100 은 값을 두 배로 만든다(클램프 포함)', () => {
        const data = pixel([60, 120, 200, 255])
        adjustPixels(data, { brightness: 100, contrast: 0, saturation: 0, hue: 0 })
        expect([...data.slice(0, 3)]).toEqual([120, 240, 255])
    })

    test('투명 픽셀은 건드리지 않는다', () => {
        const data = pixel([50, 50, 50, 0])
        adjustPixels(data, { brightness: 100, contrast: 50, saturation: 50, hue: 90 })
        expect([...data]).toEqual([50, 50, 50, 0])
    })
})
