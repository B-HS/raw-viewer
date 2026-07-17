import { describe, expect, test } from 'bun:test'
import { sortEntries } from './sortEntries'
import type { ImageEntry } from '../types/ImageEntry'

const entry = (fileName: string, patch: Partial<ImageEntry> = {}): ImageEntry => ({
    imageId: fileName,
    path: `/t/${fileName}`,
    fileName,
    isRaw: true,
    modifiedMs: null,
    fileSize: null,
    isAnimated: false,
    ...patch,
})

describe('sortEntries', () => {
    test('파일명은 자연 정렬한다 (IMG_2 < IMG_10)', () => {
        const sorted = sortEntries([entry('IMG_10.CR2'), entry('IMG_2.CR2')], 'name', 'asc')
        expect(sorted.map((item) => item.fileName)).toEqual(['IMG_2.CR2', 'IMG_10.CR2'])
    })

    test('파일명 내림차순을 지원한다', () => {
        const sorted = sortEntries([entry('a.jpg'), entry('b.jpg')], 'name', 'desc')
        expect(sorted.map((item) => item.fileName)).toEqual(['b.jpg', 'a.jpg'])
    })

    test('수정일 기준 정렬한다', () => {
        const sorted = sortEntries([entry('new.jpg', { modifiedMs: 2000 }), entry('old.jpg', { modifiedMs: 1000 })], 'modifiedDate', 'asc')
        expect(sorted.map((item) => item.fileName)).toEqual(['old.jpg', 'new.jpg'])
    })

    test('파일 크기 내림차순 정렬한다', () => {
        const sorted = sortEntries([entry('small.jpg', { fileSize: 10 }), entry('big.jpg', { fileSize: 999 })], 'fileSize', 'desc')
        expect(sorted.map((item) => item.fileName)).toEqual(['big.jpg', 'small.jpg'])
    })

    test('촬영일시는 aux 맵을 사용하고 값 없는 항목은 뒤로 보낸다', () => {
        const sorted = sortEntries([entry('nodate.jpg'), entry('b.jpg'), entry('a.jpg')], 'captureDate', 'asc', {
            captureMs: { 'a.jpg': 1000, 'b.jpg': 2000, 'nodate.jpg': null },
        })
        expect(sorted.map((item) => item.fileName)).toEqual(['a.jpg', 'b.jpg', 'nodate.jpg'])
    })

    test('별점 정렬은 미평가를 0점으로 취급하고 동률은 파일명 순', () => {
        const sorted = sortEntries([entry('b.jpg'), entry('a.jpg'), entry('star.jpg')], 'rating', 'desc', {
            ratings: { 'star.jpg': 5 },
        })
        expect(sorted.map((item) => item.fileName)).toEqual(['star.jpg', 'a.jpg', 'b.jpg'])
    })
})
