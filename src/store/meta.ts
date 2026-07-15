import { create } from 'zustand'
import { getMetadata } from '../ipc/meta'
import type { ImageMetadata } from '../types/ImageMetadata'

const COLLAPSE_KEY = 'raw-viewer:meta-collapsed'

const loadCollapsed = () => {
    try {
        const raw = localStorage.getItem(COLLAPSE_KEY)
        return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
    } catch {
        return {}
    }
}

const persistCollapsed = (collapsed: Record<string, boolean>) => {
    try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed))
    } catch {}
}

type MetaState = {
    imageId: string | null
    metadata: ImageMetadata | null
    loading: boolean
    error: string | null
    collapsed: Record<string, boolean>
    loadForImage: (imageId: string) => Promise<void>
    clear: () => void
    toggleSection: (key: string) => void
}

export const useMeta = create<MetaState>((set, get) => {
    let token = 0
    return {
        imageId: null,
        metadata: null,
        loading: false,
        error: null,
        collapsed: loadCollapsed(),
        loadForImage: async (imageId) => {
            if (get().imageId === imageId && get().metadata) return
            const current = ++token
            set({ imageId, loading: true, error: null })
            try {
                const metadata = await getMetadata(imageId)
                if (token !== current) return
                set({ metadata, loading: false })
            } catch (error) {
                if (token !== current) return
                set({ metadata: null, loading: false, error: error instanceof Error ? error.message : '메타데이터를 불러올 수 없습니다' })
            }
        },
        clear: () => {
            token++
            set({ imageId: null, metadata: null, loading: false, error: null })
        },
        toggleSection: (key) =>
            set((state) => {
                const collapsed = { ...state.collapsed, [key]: !state.collapsed[key] }
                persistCollapsed(collapsed)
                return { collapsed }
            }),
    }
})
