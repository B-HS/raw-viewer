import { create } from 'zustand'
import type { ImageEntry } from '../types/ImageEntry'
import type { LevelReadyPayload } from '../types/LevelReadyPayload'
import type { ProxyLevel } from '../types/ProxyLevel'

export const WINDOW_RADIUS = 3

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

const sortEntries = (entries: ImageEntry[]) => [...entries].sort((a, b) => collator.compare(a.fileName, b.fileName))

const sameNumbers = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index])

export const LEVEL_RANK: Record<ProxyLevel, number> = { l0: 0, l1: 1, l2: 2 }

export const neighbors = (entries: ImageEntry[], index: number, radius: number) => {
    const prevIds: string[] = []
    const nextIds: string[] = []
    for (let distance = 1; distance <= radius; distance++) {
        const before = entries[index - distance]
        if (before) prevIds.push(before.imageId)
        const after = entries[index + distance]
        if (after) nextIds.push(after.imageId)
    }
    const current = entries[index]
    const windowIds = current ? [current.imageId, ...prevIds, ...nextIds] : [...prevIds, ...nextIds]
    return { prevIds, nextIds, windowIds }
}

type PlaylistState = {
    entries: ImageEntry[]
    currentIndex: number
    dir: string | null
    scanning: boolean
    total: number
    best: Record<string, LevelReadyPayload>
    errors: Record<string, string>
    filteredIndices: number[]
    selection: string[]
    selectionAnchor: number | null
    openWith: (entry: ImageEntry, dir: string) => void
    addEntries: (incoming: ImageEntry[], done: boolean) => void
    syncEntries: (incoming: ImageEntry[]) => void
    removeEntries: (imageIds: string[]) => void
    invalidate: (imageIds: string[]) => void
    setScanTotal: (total: number) => void
    setCurrentIndex: (index: number) => void
    focusIndex: (index: number) => void
    selectToggle: (index: number) => void
    selectRange: (imageIds: string[], index: number) => void
    selectAll: (imageIds: string[]) => void
    clearSelection: () => void
    setFilteredIndices: (indices: number[]) => void
    goFirst: () => void
    goLast: () => void
    setLevel: (payload: LevelReadyPayload) => void
    setError: (imageId: string, message: string) => void
}

export const usePlaylist = create<PlaylistState>((set) => ({
    entries: [],
    currentIndex: 0,
    dir: null,
    scanning: false,
    total: 0,
    best: {},
    errors: {},
    filteredIndices: [],
    selection: [],
    selectionAnchor: null,
    openWith: (entry, dir) =>
        set({
            entries: [entry],
            currentIndex: 0,
            dir,
            scanning: true,
            total: 0,
            best: {},
            errors: {},
            filteredIndices: [0],
            selection: [entry.imageId],
            selectionAnchor: 0,
        }),
    addEntries: (incoming, done) =>
        set((state) => {
            const currentId = state.entries[state.currentIndex]?.imageId
            const merged = new Map(state.entries.map((entry) => [entry.imageId, entry]))
            for (const entry of incoming) merged.set(entry.imageId, entry)
            const entries = sortEntries([...merged.values()])
            const relocated = currentId ? entries.findIndex((entry) => entry.imageId === currentId) : 0
            return { entries, currentIndex: relocated < 0 ? 0 : relocated, scanning: !done }
        }),
    syncEntries: (incoming) =>
        set((state) => {
            const entries = sortEntries(incoming)
            const ids = new Set(entries.map((entry) => entry.imageId))
            const currentId = state.entries[state.currentIndex]?.imageId
            const best = Object.fromEntries(Object.entries(state.best).filter(([id]) => ids.has(id)))
            const errors = Object.fromEntries(Object.entries(state.errors).filter(([id]) => ids.has(id)))
            const selection = state.selection.filter((id) => ids.has(id))
            let currentIndex = 0
            if (entries.length > 0 && currentId) {
                const relocated = entries.findIndex((entry) => entry.imageId === currentId)
                currentIndex = relocated < 0 ? Math.min(state.currentIndex, entries.length - 1) : relocated
            }
            return { entries, currentIndex, best, errors, selection, selectionAnchor: null }
        }),
    removeEntries: (imageIds) =>
        set((state) => {
            if (imageIds.length === 0) return state
            const remove = new Set(imageIds)
            const currentId = state.entries[state.currentIndex]?.imageId
            const entries = state.entries.filter((entry) => !remove.has(entry.imageId))
            const best = { ...state.best }
            const errors = { ...state.errors }
            for (const id of imageIds) {
                delete best[id]
                delete errors[id]
            }
            const selection = state.selection.filter((id) => !remove.has(id))
            if (entries.length === 0) return { entries, currentIndex: 0, best, errors, selection: [], selectionAnchor: null }
            let currentIndex = Math.min(state.currentIndex, entries.length - 1)
            if (currentId && !remove.has(currentId)) {
                const relocated = entries.findIndex((entry) => entry.imageId === currentId)
                if (relocated >= 0) currentIndex = relocated
            }
            return { entries, currentIndex, best, errors, selection, selectionAnchor: null }
        }),
    invalidate: (imageIds) =>
        set((state) => {
            const best = { ...state.best }
            for (const id of imageIds) delete best[id]
            return { best }
        }),
    setScanTotal: (total) => set({ total }),
    setCurrentIndex: (index) =>
        set((state) => {
            const max = state.entries.length - 1
            if (max < 0) return { currentIndex: 0 }
            return { currentIndex: index < 0 ? 0 : index > max ? max : index }
        }),
    focusIndex: (index) =>
        set((state) => {
            const max = state.entries.length - 1
            if (max < 0) return { currentIndex: 0, selection: [], selectionAnchor: null }
            const clamped = index < 0 ? 0 : index > max ? max : index
            return { currentIndex: clamped, selection: [state.entries[clamped].imageId], selectionAnchor: clamped }
        }),
    selectToggle: (index) =>
        set((state) => {
            const entry = state.entries[index]
            if (!entry) return state
            const selection = state.selection.includes(entry.imageId)
                ? state.selection.filter((id) => id !== entry.imageId)
                : [...state.selection, entry.imageId]
            return { currentIndex: index, selection, selectionAnchor: index }
        }),
    selectRange: (imageIds, index) =>
        set((state) => {
            const max = state.entries.length - 1
            if (max < 0) return state
            return { currentIndex: index < 0 ? 0 : index > max ? max : index, selection: imageIds }
        }),
    selectAll: (imageIds) => set({ selection: imageIds, selectionAnchor: null }),
    clearSelection: () => set({ selection: [], selectionAnchor: null }),
    setFilteredIndices: (indices) => set((state) => (sameNumbers(state.filteredIndices, indices) ? state : { filteredIndices: indices })),
    goFirst: () => set({ currentIndex: 0 }),
    goLast: () => set((state) => ({ currentIndex: Math.max(0, state.entries.length - 1) })),
    setLevel: (payload) =>
        set((state) => {
            const existing = state.best[payload.imageId]
            if (existing && LEVEL_RANK[existing.level] > LEVEL_RANK[payload.level]) return state
            const errors = { ...state.errors }
            delete errors[payload.imageId]
            return { best: { ...state.best, [payload.imageId]: payload }, errors }
        }),
    setError: (imageId, message) => set((state) => ({ errors: { ...state.errors, [imageId]: message } })),
}))
