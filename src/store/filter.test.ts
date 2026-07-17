import { describe, expect, test } from 'bun:test'
import { matchesFilter } from './filter'
import type { ImageEntry } from '../types/ImageEntry'
import type { OrganizeEntry } from '../types/OrganizeEntry'

const entry = (fileName: string, isRaw = true): ImageEntry => ({
    imageId: fileName,
    path: `/t/${fileName}`,
    fileName,
    isRaw,
    modifiedMs: null,
    fileSize: null,
})

const organize = (patch: Partial<OrganizeEntry>): OrganizeEntry => ({ imageId: 'x', rating: 0, flag: null, label: null, ...patch })

const NONE = { minRating: 0, flag: null, label: null, editedOnly: false, rawOnly: false, search: '' }

describe('matchesFilter', () => {
    test('빈 필터는 전부 통과한다', () => {
        expect(matchesFilter(NONE, entry('a.cr2'), undefined, false)).toBe(true)
    })

    test('최소 별점 필터', () => {
        expect(matchesFilter({ ...NONE, minRating: 3 }, entry('a.cr2'), organize({ rating: 2 }), false)).toBe(false)
        expect(matchesFilter({ ...NONE, minRating: 3 }, entry('a.cr2'), organize({ rating: 3 }), false)).toBe(true)
        expect(matchesFilter({ ...NONE, minRating: 1 }, entry('a.cr2'), undefined, false)).toBe(false)
    })

    test('플래그·라벨 필터', () => {
        expect(matchesFilter({ ...NONE, flag: 'pick' }, entry('a.cr2'), organize({ flag: 'pick' }), false)).toBe(true)
        expect(matchesFilter({ ...NONE, flag: 'pick' }, entry('a.cr2'), organize({ flag: null }), false)).toBe(false)
        expect(matchesFilter({ ...NONE, label: 'Red' }, entry('a.cr2'), organize({ label: 'Red' }), false)).toBe(true)
        expect(matchesFilter({ ...NONE, label: 'Red' }, entry('a.cr2'), undefined, false)).toBe(false)
    })

    test('편집됨·RAW 전용 필터', () => {
        expect(matchesFilter({ ...NONE, editedOnly: true }, entry('a.cr2'), undefined, false)).toBe(false)
        expect(matchesFilter({ ...NONE, editedOnly: true }, entry('a.cr2'), undefined, true)).toBe(true)
        expect(matchesFilter({ ...NONE, rawOnly: true }, entry('a.jpg', false), undefined, false)).toBe(false)
    })

    test('파일명 검색은 대소문자 무시 부분 일치', () => {
        expect(matchesFilter({ ...NONE, search: 'img_00' }, entry('IMG_001.CR2'), undefined, false)).toBe(true)
        expect(matchesFilter({ ...NONE, search: 'nope' }, entry('IMG_001.CR2'), undefined, false)).toBe(false)
    })
})
