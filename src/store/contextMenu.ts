import { create } from 'zustand'

type ContextMenuState = {
    open: boolean
    x: number
    y: number
    imageIds: string[]
    openAt: (x: number, y: number, imageIds: string[]) => void
    close: () => void
}

export const useContextMenu = create<ContextMenuState>((set) => ({
    open: false,
    x: 0,
    y: 0,
    imageIds: [],
    openAt: (x, y, imageIds) => set({ open: true, x, y, imageIds }),
    close: () => set({ open: false, imageIds: [] }),
}))
