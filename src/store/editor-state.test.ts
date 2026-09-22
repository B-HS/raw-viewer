import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'

import type { EditStateEnvelope } from '../types/EditStateEnvelope'

Object.defineProperty(globalThis, 'navigator', { value: { language: 'en' }, configurable: true })
const { useEditStore } = await import('./editStore')
const { DEFAULT_EDIT_STATE } = await import('./editDefaults')
const { connectHistoryTarget, useHistoryStore } = await import('./historyStore')
const { addDrawerLayer, appendDrawerObject, duplicateDrawerLayer, renameDrawerLayer } = await import('./drawer')
const { usePlaylist } = await import('./playlist')
const { useUiStore } = await import('./uiStore')

const entry = { imageId: 'test', path: '/test.jpg', fileName: 'test.jpg', isRaw: false, isAnimated: false, modifiedMs: null, fileSize: null }
const envelope = { state: structuredClone(DEFAULT_EDIT_STATE), editVersion: 1, isDefault: true } satisfies EditStateEnvelope
Object.defineProperty(globalThis, 'window', { value: {}, configurable: true })

beforeEach(async () => {
    mockIPC((command) => (command === 'get_edit_state' ? structuredClone(envelope) : 1))
    await useEditStore.getState().flushPending()
    useHistoryStore.setState({ stacks: {}, dragKey: null, dragStarted: false })
    connectHistoryTarget({ imageId: () => useEditStore.getState().imageId, applyPatches: (patches) => useEditStore.getState().applyPatches(patches) })
    usePlaylist.setState({ entries: [entry], currentIndex: 0 })
    await useEditStore.getState().loadForImage(entry.imageId, false)
})

afterAll(async () => {
    mockIPC(() => 1)
    await useEditStore.getState().flushPending()
    clearMocks()
})

describe('레이어 편집과 저장', () => {
    test('편집 탭 진입 시 슬라이드쇼와 캔버스 충돌 모드를 해제합니다', () => {
        useUiStore.setState({ slideshowActive: true, cropEditMode: true, scanEditMode: true, sideBySide: true, eyedropper: true })
        useUiStore.getState().setWorkspace('editor')
        const ui = useUiStore.getState()
        expect([ui.slideshowActive, ui.cropEditMode, ui.scanEditMode, ui.sideBySide, ui.eyedropper]).toEqual([false, false, false, false, false])
        expect(ui.drawerEditMode).toBe(true)
    })

    test('레이어 복제는 독립 ID와 내용을 가지며 이름 변경을 되돌립니다', () => {
        const id = addDrawerLayer()
        if (!id) throw new Error('레이어가 생성되지 않았습니다')
        appendDrawerObject(id, { kind: 'text', text: 'sample', color: '#ffffff', size: 2, position: [0.5, 0.5] })
        duplicateDrawerLayer(id)
        const layers = useEditStore.getState().state?.drawer?.layers ?? []
        expect(layers.length).toBe(2)
        expect(layers[1].id).not.toBe(id)
        expect(layers[1].objects).toEqual(layers[0].objects)
        renameDrawerLayer(layers[1].id, '새 이름')
        useHistoryStore.getState().undo()
        expect(useEditStore.getState().state?.drawer?.layers[1].name).toBe(layers[1].name)
    })

    test('연속된 두 획은 각각 한 번에 실행 취소하고 전체 점을 복원합니다', () => {
        const id = addDrawerLayer()
        if (!id) throw new Error('레이어가 생성되지 않았습니다')
        const history = useHistoryStore.getState()
        for (const x of [0.2, 0.6]) {
            history.beginCoalesce('drawer.draw')
            appendDrawerObject(id, { kind: 'stroke', tool: 'brush', color: '#fff', size: 2, opacity: 100, points: [[x, 0.5]], clip: null })
            history.endCoalesce()
        }
        history.undo()
        expect(useEditStore.getState().state?.drawer?.layers[0].objects).toHaveLength(1)
        history.redo()
        expect(useEditStore.getState().state?.drawer?.layers[0].objects).toHaveLength(2)
    })

    test('저장 실패 시 변경을 유지하고 재시도합니다', async () => {
        useEditStore.getState().edit(
            (draft) => {
                draft.tone.exposure = 1
            },
            { label: '노출' },
        )
        mockIPC(() => {
            throw new Error('저장 실패')
        })
        await expect(useEditStore.getState().flushPending()).rejects.toThrow('저장 실패')
        expect(useEditStore.getState().state?.tone.exposure).toBe(1)
        mockIPC(() => 2)
        await useEditStore.getState().flushPending()
        expect(useEditStore.getState().version).toBe(2)
    })

    test('이미지 전환 후 늦은 편집 응답을 적용하지 않습니다', async () => {
        const pending = Promise.withResolvers<EditStateEnvelope>()
        mockIPC(() => pending.promise)
        const loading = useEditStore.getState().loadForImage(entry.imageId, false)
        usePlaylist.setState({ entries: [{ ...entry, imageId: 'next' }] })
        pending.resolve(envelope)
        await loading
        expect(useEditStore.getState().imageId).toBeNull()
        expect(useEditStore.getState().state).toBeNull()
    })

    test('저장 대기 중 추가 편집도 전환 전에 모두 저장합니다', async () => {
        const pending = Promise.withResolvers<number>()
        const started = Promise.withResolvers<void>()
        let calls = 0
        mockIPC(() => {
            calls += 1
            if (calls > 1) return 3
            started.resolve()
            return pending.promise
        })
        addDrawerLayer()
        const flushing = useEditStore.getState().flushPending()
        await started.promise
        addDrawerLayer()
        pending.resolve(2)
        await flushing
        expect(calls).toBe(2)
        expect(useEditStore.getState().version).toBe(3)
    })

    test('편집 로드 실패 시 기본값으로 덮어쓸 수 없습니다', async () => {
        mockIPC(() => {
            throw new Error('읽기 실패')
        })
        await useEditStore.getState().loadForImage(entry.imageId, false)
        useEditStore.getState().edit(
            (draft) => {
                draft.tone.exposure = 3
            },
            { label: '노출' },
        )
        expect(useEditStore.getState().state).toBeNull()
    })

    test('사진 전환 시 선택 영역과 복제 소스를 비웁니다', async () => {
        useUiStore.setState({
            drawerSelection: [
                [0, 0],
                [1, 0],
                [1, 1],
            ],
            drawerCloneSource: [0.5, 0.5],
        })
        await useEditStore.getState().loadForImage(entry.imageId, false)
        expect(useUiStore.getState().drawerSelection).toBeNull()
        expect(useUiStore.getState().drawerCloneSource).toBeNull()
    })
})
