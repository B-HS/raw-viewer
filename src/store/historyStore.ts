import { create } from 'zustand'
import { useEditStore } from './editStore'
import type { Patch } from 'immer'

export const MAX_HISTORY_ENTRIES = 100
const COALESCE_MS = 500

export type HistoryEntry = {
    label: string
    patches: Patch[]
    inversePatches: Patch[]
    timestamp: number
    coalesceKey?: string
}

type Stack = { undo: HistoryEntry[]; redo: HistoryEntry[] }

type HistoryState = {
    stacks: Record<string, Stack>
    dragKey: string | null
    dragStarted: boolean
    beginCoalesce: (key: string) => void
    endCoalesce: () => void
    record: (imageId: string, entry: HistoryEntry) => void
    undo: () => void
    redo: () => void
    canUndo: (imageId: string | null) => boolean
    canRedo: (imageId: string | null) => boolean
}

const emptyStack = (): Stack => ({ undo: [], redo: [] })

export const useHistoryStore = create<HistoryState>((set, get) => ({
    stacks: {},
    dragKey: null,
    dragStarted: false,
    beginCoalesce: (key) => set({ dragKey: key, dragStarted: false }),
    endCoalesce: () => set({ dragKey: null, dragStarted: false }),
    record: (imageId, entry) => {
        const state = get()
        const existing = state.stacks[imageId] ?? emptyStack()
        const undo = [...existing.undo]
        const top = undo[undo.length - 1]
        const dragging = state.dragKey !== null && state.dragKey === entry.coalesceKey
        const mergeTop =
            (dragging && state.dragStarted && top) ||
            (!dragging &&
                top &&
                top.coalesceKey !== undefined &&
                top.coalesceKey === entry.coalesceKey &&
                entry.timestamp - top.timestamp < COALESCE_MS)
        if (mergeTop && top) {
            undo[undo.length - 1] = { ...top, patches: entry.patches, timestamp: entry.timestamp, label: entry.label }
        } else {
            undo.push(entry)
            if (undo.length > MAX_HISTORY_ENTRIES) undo.shift()
        }
        set({
            stacks: { ...state.stacks, [imageId]: { undo, redo: [] } },
            dragStarted: state.dragKey !== null ? true : state.dragStarted,
        })
    },
    undo: () => {
        const imageId = useEditStore.getState().imageId
        if (!imageId) return
        const stack = get().stacks[imageId]
        if (!stack || stack.undo.length === 0) return
        const entry = stack.undo[stack.undo.length - 1]
        useEditStore.getState().applyPatches(entry.inversePatches)
        set({ stacks: { ...get().stacks, [imageId]: { undo: stack.undo.slice(0, -1), redo: [...stack.redo, entry] } } })
    },
    redo: () => {
        const imageId = useEditStore.getState().imageId
        if (!imageId) return
        const stack = get().stacks[imageId]
        if (!stack || stack.redo.length === 0) return
        const entry = stack.redo[stack.redo.length - 1]
        useEditStore.getState().applyPatches(entry.patches)
        set({ stacks: { ...get().stacks, [imageId]: { undo: [...stack.undo, entry], redo: stack.redo.slice(0, -1) } } })
    },
    canUndo: (imageId) => (imageId ? (get().stacks[imageId]?.undo.length ?? 0) > 0 : false),
    canRedo: (imageId) => (imageId ? (get().stacks[imageId]?.redo.length ?? 0) > 0 : false),
}))
