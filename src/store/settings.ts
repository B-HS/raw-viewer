import { load } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { applyLanguage } from '../i18n/i18n'
import { setPerformanceSettings } from '../ipc/performance'
import { SORT_KEYS } from '../lib/sortEntries'
import { sanitizeOverrides } from '../shortcuts/keymap'
import type { AppLanguage } from '../i18n/i18n'
import type { SortKey, SortOrder } from '../lib/sortEntries'
import type { Binding } from '../shortcuts/keymap'

export type AppTheme = 'system' | 'dark' | 'light'

export type L2Policy = 'always' | 'idle' | 'zoom'

export type SettingsValues = {
    language: AppLanguage
    theme: AppTheme
    viewportBackground: string
    useMonitorProfile: boolean
    preloadRadius: number
    l2Policy: L2Policy
    isolatedDecode: boolean
    openInNewWindow: boolean
    showAddress: boolean
    recentApps: string[]
    filmstripHeight: number
    gridCellSize: number
    slideshowIntervalMs: number
    sortKey: SortKey
    sortOrder: SortOrder
    shortcutOverrides: Record<string, Binding>
}

const RECENT_APPS_MAX = 6

const FILMSTRIP_MIN = 60
const FILMSTRIP_MAX = 200

const SLIDESHOW_MIN_MS = 1000
const SLIDESHOW_MAX_MS = 30000

export const GRID_CELL_MIN = 90
export const GRID_CELL_MAX = 260

const STORE_PATH = 'settings.json'

const clampFilmstripHeight = (value: number) => Math.max(FILMSTRIP_MIN, Math.min(FILMSTRIP_MAX, Math.round(value)))

const clampGridCellSize = (value: number) => Math.max(GRID_CELL_MIN, Math.min(GRID_CELL_MAX, Math.round(value)))

const DEFAULTS: SettingsValues = {
    language: 'system',
    theme: 'system',
    viewportBackground: '#3C3C3C',
    useMonitorProfile: false,
    preloadRadius: 3,
    l2Policy: 'idle',
    isolatedDecode: false,
    openInNewWindow: false,
    showAddress: false,
    recentApps: [],
    filmstripHeight: 96,
    gridCellSize: 140,
    slideshowIntervalMs: 3000,
    sortKey: 'name',
    sortOrder: 'asc',
    shortcutOverrides: {},
}

const clampSlideshowInterval = (value: number) => Math.max(SLIDESHOW_MIN_MS, Math.min(SLIDESHOW_MAX_MS, Math.round(value)))

const pushPerformance = (values: Pick<SettingsValues, 'preloadRadius' | 'l2Policy' | 'isolatedDecode'>) =>
    setPerformanceSettings(values.preloadRadius, values.l2Policy, values.isolatedDecode).catch(() => undefined)

let storeRef: Awaited<ReturnType<typeof load>> | null = null

const getStore = async () => {
    if (!storeRef) storeRef = await load(STORE_PATH)
    return storeRef
}

const persist = async <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => {
    try {
        const store = await getStore()
        await store.set(key, value)
        await store.save()
    } catch {}
}

const resolveTheme = (theme: AppTheme) =>
    theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme

const applyTheme = (theme: AppTheme) => {
    const resolved = resolveTheme(theme)
    document.documentElement.dataset.theme = resolved
    document.documentElement.style.colorScheme = resolved
}

const applyViewportBackground = (color: string) => document.documentElement.style.setProperty('--viewport-bg', color)

const isSortKey = (value: unknown): value is SortKey => (SORT_KEYS as readonly unknown[]).includes(value)
const isSortOrder = (value: unknown): value is SortOrder => value === 'asc' || value === 'desc'

const isLanguage = (value: unknown): value is AppLanguage => value === 'system' || value === 'ko' || value === 'en'
const isTheme = (value: unknown): value is AppTheme => value === 'system' || value === 'dark' || value === 'light'
const isL2Policy = (value: unknown): value is L2Policy => value === 'always' || value === 'idle' || value === 'zoom'

type SettingsStore = SettingsValues & {
    hydrated: boolean
    hydrate: () => Promise<void>
    setLanguage: (language: AppLanguage) => void
    setTheme: (theme: AppTheme) => void
    setViewportBackground: (color: string) => void
    setUseMonitorProfile: (enabled: boolean) => void
    setPreloadRadius: (radius: number) => void
    setL2Policy: (policy: L2Policy) => void
    setIsolatedDecode: (enabled: boolean) => void
    setOpenInNewWindow: (enabled: boolean) => void
    setShowAddress: (enabled: boolean) => void
    addRecentApp: (path: string) => void
    setFilmstripHeight: (height: number) => void
    commitFilmstripHeight: () => void
    setGridCellSize: (size: number) => void
    commitGridCellSize: () => void
    setSlideshowInterval: (ms: number) => void
    setSort: (key: SortKey, order: SortOrder) => void
    setShortcutBinding: (id: string, binding: Binding) => void
    resetShortcutBinding: (id: string) => void
    resetShortcutBindings: () => void
}

export const useSettings = create<SettingsStore>((set, get) => ({
    ...DEFAULTS,
    hydrated: false,
    hydrate: async () => {
        let values: SettingsValues = { ...DEFAULTS }
        try {
            const store = await getStore()
            const language = await store.get('language')
            const theme = await store.get('theme')
            const viewportBackground = await store.get('viewportBackground')
            const useMonitorProfile = await store.get('useMonitorProfile')
            const preloadRadius = await store.get('preloadRadius')
            const l2Policy = await store.get('l2Policy')
            const isolatedDecode = await store.get('isolatedDecode')
            const openInNewWindow = await store.get('openInNewWindow')
            const showAddress = await store.get('showAddress')
            const recentApps = await store.get('recentApps')
            const filmstripHeight = await store.get('filmstripHeight')
            const gridCellSize = await store.get('gridCellSize')
            const slideshowIntervalMs = await store.get('slideshowIntervalMs')
            const sortKey = await store.get('sortKey')
            const sortOrder = await store.get('sortOrder')
            const shortcutOverrides = await store.get('shortcutOverrides')
            values = {
                language: isLanguage(language) ? language : DEFAULTS.language,
                theme: isTheme(theme) ? theme : DEFAULTS.theme,
                viewportBackground: typeof viewportBackground === 'string' ? viewportBackground : DEFAULTS.viewportBackground,
                useMonitorProfile: typeof useMonitorProfile === 'boolean' ? useMonitorProfile : DEFAULTS.useMonitorProfile,
                preloadRadius: typeof preloadRadius === 'number' ? Math.max(0, Math.min(10, Math.round(preloadRadius))) : DEFAULTS.preloadRadius,
                l2Policy: isL2Policy(l2Policy) ? l2Policy : DEFAULTS.l2Policy,
                isolatedDecode: typeof isolatedDecode === 'boolean' ? isolatedDecode : DEFAULTS.isolatedDecode,
                openInNewWindow: typeof openInNewWindow === 'boolean' ? openInNewWindow : DEFAULTS.openInNewWindow,
                showAddress: typeof showAddress === 'boolean' ? showAddress : DEFAULTS.showAddress,
                recentApps: Array.isArray(recentApps) ? recentApps.filter((item): item is string => typeof item === 'string') : DEFAULTS.recentApps,
                filmstripHeight: typeof filmstripHeight === 'number' ? clampFilmstripHeight(filmstripHeight) : DEFAULTS.filmstripHeight,
                gridCellSize: typeof gridCellSize === 'number' ? clampGridCellSize(gridCellSize) : DEFAULTS.gridCellSize,
                slideshowIntervalMs:
                    typeof slideshowIntervalMs === 'number' ? clampSlideshowInterval(slideshowIntervalMs) : DEFAULTS.slideshowIntervalMs,
                sortKey: isSortKey(sortKey) ? sortKey : DEFAULTS.sortKey,
                sortOrder: isSortOrder(sortOrder) ? sortOrder : DEFAULTS.sortOrder,
                shortcutOverrides: sanitizeOverrides(shortcutOverrides),
            }
        } catch {}
        set({ ...values, hydrated: true })
        applyLanguage(values.language)
        applyTheme(values.theme)
        applyViewportBackground(values.viewportBackground)
        pushPerformance(values)
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (get().theme === 'system') applyTheme('system')
        })
    },
    setLanguage: (language) => {
        set({ language })
        applyLanguage(language)
        persist('language', language)
    },
    setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
        persist('theme', theme)
    },
    setViewportBackground: (color) => {
        set({ viewportBackground: color })
        applyViewportBackground(color)
        persist('viewportBackground', color)
    },
    setUseMonitorProfile: (enabled) => {
        set({ useMonitorProfile: enabled })
        persist('useMonitorProfile', enabled)
    },
    setPreloadRadius: (radius) => {
        const clamped = Math.max(0, Math.min(10, Math.round(radius)))
        set({ preloadRadius: clamped })
        persist('preloadRadius', clamped)
        pushPerformance(get())
    },
    setL2Policy: (policy) => {
        set({ l2Policy: policy })
        persist('l2Policy', policy)
        pushPerformance(get())
    },
    setIsolatedDecode: (enabled) => {
        set({ isolatedDecode: enabled })
        persist('isolatedDecode', enabled)
        pushPerformance(get())
    },
    setOpenInNewWindow: (enabled) => {
        set({ openInNewWindow: enabled })
        persist('openInNewWindow', enabled)
    },
    setShowAddress: (enabled) => {
        set({ showAddress: enabled })
        persist('showAddress', enabled)
    },
    addRecentApp: (path) => {
        const recentApps = [path, ...get().recentApps.filter((item) => item !== path)].slice(0, RECENT_APPS_MAX)
        set({ recentApps })
        persist('recentApps', recentApps)
    },
    setFilmstripHeight: (height) => set({ filmstripHeight: clampFilmstripHeight(height) }),
    commitFilmstripHeight: () => persist('filmstripHeight', get().filmstripHeight),
    setGridCellSize: (size) => set({ gridCellSize: clampGridCellSize(size) }),
    commitGridCellSize: () => persist('gridCellSize', get().gridCellSize),
    setSlideshowInterval: (ms) => {
        const clamped = clampSlideshowInterval(ms)
        set({ slideshowIntervalMs: clamped })
        persist('slideshowIntervalMs', clamped)
    },
    setSort: (key, order) => {
        set({ sortKey: key, sortOrder: order })
        persist('sortKey', key)
        persist('sortOrder', order)
    },
    setShortcutBinding: (id, binding) => {
        const shortcutOverrides = { ...get().shortcutOverrides, [id]: binding }
        set({ shortcutOverrides })
        persist('shortcutOverrides', shortcutOverrides)
    },
    resetShortcutBinding: (id) => {
        const shortcutOverrides = { ...get().shortcutOverrides }
        delete shortcutOverrides[id]
        set({ shortcutOverrides })
        persist('shortcutOverrides', shortcutOverrides)
    },
    resetShortcutBindings: () => {
        set({ shortcutOverrides: {} })
        persist('shortcutOverrides', {})
    },
}))
