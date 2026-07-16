import { create } from 'zustand'

export type RightPanel = 'edit' | 'meta' | 'preset' | 'history' | 'none'

const LAYOUT_KEY = 'raw-viewer:layout'

type Persisted = { rightPanel: RightPanel; filmstripVisible: boolean }

const DEFAULTS: Persisted = { rightPanel: 'edit', filmstripVisible: true }

const RIGHT_PANELS: readonly RightPanel[] = ['edit', 'meta', 'preset', 'history', 'none']

const isRightPanel = (value: unknown): value is RightPanel => (RIGHT_PANELS as readonly unknown[]).includes(value)

const sanitizePersisted = (value: unknown): Persisted => {
    if (typeof value !== 'object' || value === null) return DEFAULTS
    const record = value as Record<string, unknown>
    return {
        rightPanel: isRightPanel(record.rightPanel) ? record.rightPanel : DEFAULTS.rightPanel,
        filmstripVisible: typeof record.filmstripVisible === 'boolean' ? record.filmstripVisible : DEFAULTS.filmstripVisible,
    }
}

const load = () => {
    try {
        const raw = localStorage.getItem(LAYOUT_KEY)
        return raw ? sanitizePersisted(JSON.parse(raw)) : DEFAULTS
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
