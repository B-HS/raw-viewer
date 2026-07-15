import { create } from 'zustand'

type GridViewState = {
    active: boolean
    toggle: () => void
    open: () => void
    close: () => void
}

export const useGridView = create<GridViewState>((set) => ({
    active: false,
    toggle: () => set((state) => ({ active: !state.active })),
    open: () => set({ active: true }),
    close: () => set({ active: false }),
}))
