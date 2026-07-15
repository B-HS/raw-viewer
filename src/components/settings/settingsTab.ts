import { create } from 'zustand'

export type SettingsTab = 'general' | 'performance' | 'shortcuts' | 'cache' | 'about'

type SettingsTabState = {
    tab: SettingsTab
    setTab: (tab: SettingsTab) => void
}

export const useSettingsTab = create<SettingsTabState>((set) => ({
    tab: 'general',
    setTab: (tab) => set({ tab }),
}))
