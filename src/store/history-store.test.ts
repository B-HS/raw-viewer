import { beforeEach, describe, expect, test } from 'bun:test'
import { applyPatches, enablePatches, produceWithPatches } from 'immer'
import { connectHistoryTarget, useHistoryStore } from './historyStore'

enablePatches()

describe('편집 히스토리', () => {
    beforeEach(() => useHistoryStore.setState({ stacks: {}, dragKey: null, dragStarted: false }))

    test('한 동작의 배열 추가와 수정 전체를 실행 취소하고 복원합니다', () => {
        let state = { points: [0], opacity: 1 }
        connectHistoryTarget({
            imageId: () => 'image',
            applyPatches: (patches) => {
                state = applyPatches(state, patches)
            },
        })
        const history = useHistoryStore.getState()
        history.beginCoalesce('stroke')
        for (const point of [1, 2, 3]) {
            const [next, patches, inversePatches] = produceWithPatches(state, (draft) => {
                draft.points.push(point)
            })
            state = next
            history.record('image', { patches, inversePatches, timestamp: point, label: '그리기', coalesceKey: 'stroke' })
        }
        history.endCoalesce()
        history.undo()
        expect(state.points).toEqual([0])
        history.redo()
        expect(state.points).toEqual([0, 1, 2, 3])
    })

    test('서로 다른 필드의 연속 변경을 모두 되돌립니다', () => {
        let state = { x: 0, y: 0 }
        connectHistoryTarget({
            imageId: () => 'image',
            applyPatches: (patches) => {
                state = applyPatches(state, patches)
            },
        })
        const history = useHistoryStore.getState()
        for (const key of ['x', 'y'] as const) {
            const [next, patches, inversePatches] = produceWithPatches(state, (draft) => {
                draft[key] = 1
            })
            state = next
            history.record('image', { patches, inversePatches, timestamp: 1, label: '이동', coalesceKey: 'move' })
        }
        history.undo()
        expect(state).toEqual({ x: 0, y: 0 })
        history.redo()
        expect(state).toEqual({ x: 1, y: 1 })
    })
})
