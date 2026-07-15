import { load } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { applyLanguage } from '../i18n'
import type { AppLanguage } from '../i18n'

export type AppTheme = 'system' | 'dark' | 'light'

export type L2Policy = 'always' | 'idle' | 'zoom'

export type SettingsValues = {
    language: AppLanguage
    theme: AppTheme
    viewportBackground: string
    preloadRadius: number
    l2Policy: L2Policy
    recentApps: string[]
    filmstripHeight: number
}

const RECENT_APPS_MAX = 6

const FILMSTRIP_MIN = 60
const FILMSTRIP_MAX = 200

const STORE_PATH = 'settings.json'

const clampFilmstripHeight = (value: number) => Math.max(FILMSTRIP_MIN, Math.min(FILMSTRIP_MAX, Math.round(value)))

const DEFAULTS: SettingsValues = {
    language: 'system',
    theme: 'system',
    viewportBackground: '#3C3C3C',
    preloadRadius: 3,
    l2Policy: 'idle',
    recentApps: [],
    filmstripHeight: 96,
}

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

const isLanguage = (value: unknown): value is AppLanguage => value === 'system' || value === 'ko' || value === 'en'
const isTheme = (value: unknown): value is AppTheme => value === 'system' || value === 'dark' || value === 'light'
const isL2Policy = (value: unknown): value is L2Policy => value === 'always' || value === 'idle' || value === 'zoom'

type SettingsStore = SettingsValues & {
    hydrated: boolean
    hydrate: () => Promise<void>
    setLanguage: (language: AppLanguage) => void
    setTheme: (theme: AppTheme) => void
    setViewportBackground: (color: string) => void
    setPreloadRadius: (radius: number) => void
    setL2Policy: (policy: L2Policy) => void
    addRecentApp: (path: string) => void
    setFilmstripHeight: (height: number) => void
    commitFilmstripHeight: () => void
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
            const preloadRadius = await store.get('preloadRadius')
            const l2Policy = await store.get('l2Policy')
            const recentApps = await store.get('recentApps')
            const filmstripHeight = await store.get('filmstripHeight')
            values = {
                language: isLanguage(language) ? language : DEFAULTS.language,
                theme: isTheme(theme) ? theme : DEFAULTS.theme,
                viewportBackground: typeof viewportBackground === 'string' ? viewportBackground : DEFAULTS.viewportBackground,
                preloadRadius: typeof preloadRadius === 'number' ? Math.max(0, Math.min(10, Math.round(preloadRadius))) : DEFAULTS.preloadRadius,
                l2Policy: isL2Policy(l2Policy) ? l2Policy : DEFAULTS.l2Policy,
                recentApps: Array.isArray(recentApps) ? recentApps.filter((item): item is string => typeof item === 'string') : DEFAULTS.recentApps,
                filmstripHeight: typeof filmstripHeight === 'number' ? clampFilmstripHeight(filmstripHeight) : DEFAULTS.filmstripHeight,
            }
        } catch {}
        set({ ...values, hydrated: true })
        applyLanguage(values.language)
        applyTheme(values.theme)
        applyViewportBackground(values.viewportBackground)
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
    setPreloadRadius: (radius) => {
        const clamped = Math.max(0, Math.min(10, Math.round(radius)))
        set({ preloadRadius: clamped })
        persist('preloadRadius', clamped)
    },
    setL2Policy: (policy) => {
        set({ l2Policy: policy })
        persist('l2Policy', policy)
    },
    addRecentApp: (path) => {
        const recentApps = [path, ...get().recentApps.filter((item) => item !== path)].slice(0, RECENT_APPS_MAX)
        set({ recentApps })
        persist('recentApps', recentApps)
    },
    setFilmstripHeight: (height) => set({ filmstripHeight: clampFilmstripHeight(height) }),
    commitFilmstripHeight: () => persist('filmstripHeight', get().filmstripHeight),
}))
