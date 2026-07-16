import { create } from 'zustand'
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
    jumpTo: (imageId: string, target: number) => void
    canUndo: (imageId: string | null) => boolean
    canRedo: (imageId: string | null) => boolean
}

type HistoryTarget = {
    imageId: () => string | null
    applyPatches: (patches: Patch[]) => void
}

let target: HistoryTarget | null = null

export const connectHistoryTarget = (next: HistoryTarget) => {
    target = next
}

const emptyStack = () => ({ undo: [], redo: [] })

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
        const imageId = target?.imageId()
        if (!imageId || !target) return
        const stack = get().stacks[imageId]
        if (!stack || stack.undo.length === 0) return
        const entry = stack.undo[stack.undo.length - 1]
        target.applyPatches(entry.inversePatches)
        set({ stacks: { ...get().stacks, [imageId]: { undo: stack.undo.slice(0, -1), redo: [...stack.redo, entry] } } })
    },
    redo: () => {
        const imageId = target?.imageId()
        if (!imageId || !target) return
        const stack = get().stacks[imageId]
        if (!stack || stack.redo.length === 0) return
        const entry = stack.redo[stack.redo.length - 1]
        target.applyPatches(entry.patches)
        set({ stacks: { ...get().stacks, [imageId]: { undo: [...stack.undo, entry], redo: stack.redo.slice(0, -1) } } })
    },
    jumpTo: (imageId, targetIndex) => {
        if (!target || target.imageId() !== imageId) return
        const stack = get().stacks[imageId]
        if (!stack) return
        const timeline = [...stack.undo, ...[...stack.redo].reverse()]
        const current = stack.undo.length - 1
        const clamped = targetIndex < -1 ? -1 : targetIndex > timeline.length - 1 ? timeline.length - 1 : targetIndex
        if (clamped === current) return
        const patches: Patch[] = []
        if (clamped > current) for (let index = current + 1; index <= clamped; index++) patches.push(...timeline[index].patches)
        else for (let index = current; index > clamped; index--) patches.push(...timeline[index].inversePatches)
        target.applyPatches(patches)
        set({ stacks: { ...get().stacks, [imageId]: { undo: timeline.slice(0, clamped + 1), redo: timeline.slice(clamped + 1).reverse() } } })
    },
    canUndo: (imageId) => (imageId ? (get().stacks[imageId]?.undo.length ?? 0) > 0 : false),
    canRedo: (imageId) => (imageId ? (get().stacks[imageId]?.redo.length ?? 0) > 0 : false),
}))
