import { create } from 'zustand'

type OverlaysState = {
    settingsOpen: boolean
    aboutOpen: boolean
    paletteOpen: boolean
    openSettings: () => void
    closeSettings: () => void
    openAbout: () => void
    closeAbout: () => void
    togglePalette: () => void
    closePalette: () => void
}

export const useOverlays = create<OverlaysState>((set) => ({
    settingsOpen: false,
    aboutOpen: false,
    paletteOpen: false,
    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => set({ settingsOpen: false }),
    openAbout: () => set({ aboutOpen: true }),
    closeAbout: () => set({ aboutOpen: false }),
    togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
    closePalette: () => set({ paletteOpen: false }),
}))
