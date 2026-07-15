import { create } from 'zustand'
import { findLensProfile } from '../ipc/lens'
import { useUiStore } from './uiStore'
import type { LensProfileMatch } from '../types/LensProfileMatch'

const pushEngine = (imageId: string | null, match: LensProfileMatch | null) => useUiStore.getState().engine?.setLensProfile(imageId, match)

type LensState = {
    imageId: string | null
    match: LensProfileMatch | null
    loading: boolean
    cache: Map<string, LensProfileMatch | null>
    loadForImage: (imageId: string) => Promise<void>
    resolve: (imageId: string) => Promise<LensProfileMatch | null>
    refreshCurrent: () => Promise<void>
    clear: () => void
    syncEngine: () => void
}

export const useLens = create<LensState>((set, get) => {
    let token = 0
    const fetchProfile = async (imageId: string) => {
        const cache = get().cache
        if (cache.has(imageId)) return cache.get(imageId) ?? null
        const match = await findLensProfile(imageId).catch(() => null)
        get().cache.set(imageId, match)
        return match
    }
    return {
        imageId: null,
        match: null,
        loading: false,
        cache: new Map(),
        loadForImage: async (imageId) => {
            const current = ++token
            const cached = get().cache.get(imageId) ?? null
            set({ imageId, match: cached, loading: !get().cache.has(imageId) })
            pushEngine(imageId, cached)
            if (get().cache.has(imageId)) return
            const match = await fetchProfile(imageId)
            if (token !== current) return
            set({ match, loading: false })
            pushEngine(imageId, match)
        },
        resolve: (imageId) => fetchProfile(imageId),
        refreshCurrent: async () => {
            const imageId = get().imageId
            get().cache.clear()
            if (!imageId) return
            const current = ++token
            set({ loading: true })
            const match = await fetchProfile(imageId)
            if (token !== current) return
            set({ match, loading: false })
            pushEngine(imageId, match)
        },
        clear: () => {
            token++
            set({ imageId: null, match: null, loading: false })
            pushEngine(null, null)
        },
        syncEngine: () => pushEngine(get().imageId, get().match),
    }
})
