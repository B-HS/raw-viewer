import { describe, expect, test } from 'bun:test'
import { activeConflicts, bindingsEqual, DEFAULT_BINDINGS, sanitizeOverrides, serializeBinding, SHORTCUT_ACTIONS } from './keymap'

describe('sanitizeOverrides', () => {
    test('알 수 없는 액션 id와 잘못된 형태를 걸러낸다', () => {
        const result = sanitizeOverrides({
            'nav.next': { code: 'KeyN', meta: true },
            'unknown.action': { code: 'KeyX' },
            'nav.previous': 'not-a-binding',
        })
        expect(Object.keys(result)).toEqual(['nav.next'])
        expect(result['nav.next']).toEqual({ code: 'KeyN', meta: true, shift: false, alt: false, ctrl: false })
    })

    test('객체가 아니면 빈 결과를 반환한다', () => {
        expect(sanitizeOverrides(null)).toEqual({})
        expect(sanitizeOverrides('x')).toEqual({})
    })
})

describe('serializeBinding · bindingsEqual', () => {
    test('수정자 유무를 구분한다', () => {
        expect(bindingsEqual({ code: 'KeyA' }, { code: 'KeyA', meta: false })).toBe(true)
        expect(bindingsEqual({ code: 'KeyA' }, { code: 'KeyA', meta: true })).toBe(false)
        expect(serializeBinding({ code: 'KeyA', meta: true, shift: true })).toBe('KeyA|1100')
    })
})

describe('activeConflicts', () => {
    test('기본 바인딩은 충돌이 없다', () => {
        expect(activeConflicts({}).size).toBe(0)
    })

    test('겹치는 override는 두 액션 모두 충돌로 표시한다', () => {
        const conflicts = activeConflicts({ 'nav.next': DEFAULT_BINDINGS['nav.previous'] })
        expect(conflicts.has('nav.next')).toBe(true)
        expect(conflicts.has('nav.previous')).toBe(true)
    })

    test('모든 액션에 라벨과 섹션이 있다', () => {
        for (const action of SHORTCUT_ACTIONS) {
            expect(action.label.startsWith('shortcut.')).toBe(true)
            expect(action.binding.code.length).toBeGreaterThan(0)
        }
    })
})
