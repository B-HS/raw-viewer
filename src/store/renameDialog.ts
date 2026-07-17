import { create } from 'zustand'
import type { ImageEntry } from '../types/ImageEntry'

type RenameDialogState = {
    target: ImageEntry | null
    openFor: (entry: ImageEntry) => void
    close: () => void
}

export const useRenameDialog = create<RenameDialogState>((set) => ({
    target: null,
    openFor: (entry) => set({ target: entry }),
    close: () => set({ target: null }),
}))
