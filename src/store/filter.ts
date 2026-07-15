import { create } from 'zustand'
import type { Flag } from '../types/Flag'
import type { ImageEntry } from '../types/ImageEntry'
import type { OrganizeEntry } from '../types/OrganizeEntry'

type FilterCriteria = {
    minRating: number
    flag: Flag | null
    label: string | null
    editedOnly: boolean
    rawOnly: boolean
    search: string
}

type FilterState = FilterCriteria & {
    setMinRating: (value: number) => void
    setFlag: (value: Flag | null) => void
    setLabel: (value: string | null) => void
    toggleEditedOnly: () => void
    toggleRawOnly: () => void
    setSearch: (value: string) => void
    reset: () => void
}

const INITIAL: FilterCriteria = { minRating: 0, flag: null, label: null, editedOnly: false, rawOnly: false, search: '' }

export const useFilter = create<FilterState>((set) => ({
    ...INITIAL,
    setMinRating: (value) => set((state) => ({ minRating: state.minRating === value ? 0 : value })),
    setFlag: (value) => set((state) => ({ flag: state.flag === value ? null : value })),
    setLabel: (value) => set((state) => ({ label: state.label === value ? null : value })),
    toggleEditedOnly: () => set((state) => ({ editedOnly: !state.editedOnly })),
    toggleRawOnly: () => set((state) => ({ rawOnly: !state.rawOnly })),
    setSearch: (value) => set({ search: value }),
    reset: () => set({ ...INITIAL }),
}))

export const isFilterActive = (state: FilterCriteria) =>
    state.minRating > 0 || state.flag !== null || state.label !== null || state.editedOnly || state.rawOnly || state.search.trim() !== ''

export const matchesFilter = (state: FilterCriteria, entry: ImageEntry, organize: OrganizeEntry | undefined, edited: boolean) => {
    if (state.minRating > 0 && (organize?.rating ?? 0) < state.minRating) return false
    if (state.flag !== null && organize?.flag !== state.flag) return false
    if (state.label !== null && organize?.label !== state.label) return false
    if (state.editedOnly && !edited) return false
    if (state.rawOnly && !entry.isRaw) return false
    const query = state.search.trim().toLowerCase()
    if (query !== '' && !entry.fileName.toLowerCase().includes(query)) return false
    return true
}
