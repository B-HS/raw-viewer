import { create } from 'zustand'
import { getPairs } from '../ipc/platform'

type PairsState = {
    jpegByRaw: Record<string, string>
    load: (dir: string) => Promise<void>
    clear: () => void
    isPaired: (rawId: string) => boolean
}

export const usePairs = create<PairsState>((set, get) => ({
    jpegByRaw: {},
    load: async (dir) => {
        const pairs = await getPairs(dir).catch(() => [])
        const jpegByRaw: Record<string, string> = {}
        for (const pair of pairs) jpegByRaw[pair.rawId] = pair.jpegPath
        set({ jpegByRaw })
    },
    clear: () => set({ jpegByRaw: {} }),
    isPaired: (rawId) => get().jpegByRaw[rawId] !== undefined,
}))
