import { create } from 'zustand'

export type RightPanel = 'edit' | 'meta' | 'preset' | 'history' | 'none'

const LAYOUT_KEY = 'raw-viewer:layout'

type Persisted = {
    rightPanel: RightPanel
    lastRightPanel: Exclude<RightPanel, 'none'>
    filmstripVisible: boolean
    quickBarVisible: boolean
    statusBarVisible: boolean
    viewerPillVisible: boolean
}

const DEFAULTS: Persisted = {
    rightPanel: 'edit',
    lastRightPanel: 'edit',
    filmstripVisible: true,
    quickBarVisible: true,
    statusBarVisible: true,
    viewerPillVisible: true,
}

const RIGHT_PANELS: readonly RightPanel[] = ['edit', 'meta', 'preset', 'history', 'none']

const isRightPanel = (value: unknown): value is RightPanel => (RIGHT_PANELS as readonly unknown[]).includes(value)

const isOpenPanel = (value: unknown): value is Exclude<RightPanel, 'none'> => isRightPanel(value) && value !== 'none'

const boolOr = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

const sanitizePersisted = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return DEFAULTS
    const record = value as Record<string, unknown>
    return {
        rightPanel: isRightPanel(record.rightPanel) ? record.rightPanel : DEFAULTS.rightPanel,
        lastRightPanel: isOpenPanel(record.lastRightPanel) ? record.lastRightPanel : DEFAULTS.lastRightPanel,
        filmstripVisible: boolOr(record.filmstripVisible, DEFAULTS.filmstripVisible),
        quickBarVisible: boolOr(record.quickBarVisible, DEFAULTS.quickBarVisible),
        statusBarVisible: boolOr(record.statusBarVisible, DEFAULTS.statusBarVisible),
        viewerPillVisible: boolOr(record.viewerPillVisible, DEFAULTS.viewerPillVisible),
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
    reopenRightPanel: () => void
    toggleRightPanel: () => void
    toggleFilmstrip: () => void
    toggleQuickBar: () => void
    toggleStatusBar: () => void
    toggleViewerPill: () => void
}

export const useLayout = create<LayoutState>((set, get) => {
    const snapshot = (): Persisted => {
        const { rightPanel, lastRightPanel, filmstripVisible, quickBarVisible, statusBarVisible, viewerPillVisible } = get()
        return { rightPanel, lastRightPanel, filmstripVisible, quickBarVisible, statusBarVisible, viewerPillVisible }
    }
    const save = (next: Partial<Persisted>) => {
        persist({ ...snapshot(), ...next })
        set(next)
    }
    const setRightPanel = (panel: RightPanel) => {
        const current = get().rightPanel
        save(panel === 'none' && current !== 'none' ? { rightPanel: 'none', lastRightPanel: current } : { rightPanel: panel })
    }
    return {
        ...load(),
        toggleEditPanel: () => setRightPanel(get().rightPanel === 'edit' ? 'none' : 'edit'),
        toggleMetaPanel: () => setRightPanel(get().rightPanel === 'meta' ? 'none' : 'meta'),
        selectRightPanel: (panel) => setRightPanel(get().rightPanel === panel ? 'none' : panel),
        reopenRightPanel: () => setRightPanel(get().lastRightPanel),
        toggleRightPanel: () => setRightPanel(get().rightPanel === 'none' ? get().lastRightPanel : 'none'),
        toggleFilmstrip: () => save({ filmstripVisible: !get().filmstripVisible }),
        toggleQuickBar: () => save({ quickBarVisible: !get().quickBarVisible }),
        toggleStatusBar: () => save({ statusBarVisible: !get().statusBarVisible }),
        toggleViewerPill: () => save({ viewerPillVisible: !get().viewerPillVisible }),
    }
})
