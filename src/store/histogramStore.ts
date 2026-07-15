import { create } from 'zustand'

export type HistogramData = { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array }

export type HistogramMode = 'rgb' | 'luma' | 'separate'

export type ToneRange = { lo: number; hi: number }

const MODE_ORDER: HistogramMode[] = ['rgb', 'luma', 'separate']

type HistogramState = {
    data: HistogramData | null
    mode: HistogramMode
    hoverRange: ToneRange | null
    setData: (data: HistogramData | null) => void
    cycleMode: () => void
    setHoverRange: (range: ToneRange | null) => void
}

export const useHistogram = create<HistogramState>((set) => ({
    data: null,
    mode: 'rgb',
    hoverRange: null,
    setData: (data) => set({ data }),
    cycleMode: () => set((state) => ({ mode: MODE_ORDER[(MODE_ORDER.indexOf(state.mode) + 1) % MODE_ORDER.length] })),
    setHoverRange: (range) =>
        set((state) => {
            if (range === state.hoverRange) return state
            if (range && state.hoverRange && range.lo === state.hoverRange.lo && range.hi === state.hoverRange.hi) return state
            return { hoverRange: range }
        }),
}))
