import { create } from 'zustand'

export type RightPanel = 'edit' | 'meta' | 'preset' | 'none'

const LAYOUT_KEY = 'raw-viewer:layout'

type Persisted = { rightPanel: RightPanel; filmstripVisible: boolean }

const DEFAULTS: Persisted = { rightPanel: 'edit', filmstripVisible: true }

const load = () => {
    try {
        const raw = localStorage.getItem(LAYOUT_KEY)
        return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) } : DEFAULTS
    } catch {
        return DEFAULTS
    }
}

const persist = (value: Persisted) => {
    try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(value))
    } catch {}
}

type LayoutState = Persisted & {
    toggleEditPanel: () => void
    toggleMetaPanel: () => void
    selectRightPanel: (panel: Exclude<RightPanel, 'none'>) => void
    toggleFilmstrip: () => void
}

export const useLayout = create<LayoutState>((set, get) => {
    const save = (next: Partial<Persisted>) => {
        const merged: Persisted = { rightPanel: get().rightPanel, filmstripVisible: get().filmstripVisible, ...next }
        persist(merged)
        set(next)
    }
    return {
        ...load(),
        toggleEditPanel: () => save({ rightPanel: get().rightPanel === 'edit' ? 'none' : 'edit' }),
        toggleMetaPanel: () => save({ rightPanel: get().rightPanel === 'meta' ? 'none' : 'meta' }),
        selectRightPanel: (panel) => save({ rightPanel: get().rightPanel === panel ? 'none' : panel }),
        toggleFilmstrip: () => save({ filmstripVisible: !get().filmstripVisible }),
    }
})
