import { create } from 'zustand'

export type HistogramData = { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array }

export type HistogramMode = 'rgb' | 'luma' | 'separate'

const MODE_ORDER: HistogramMode[] = ['rgb', 'luma', 'separate']

type HistogramState = {
    data: HistogramData | null
    mode: HistogramMode
    setData: (data: HistogramData | null) => void
    cycleMode: () => void
}

export const useHistogram = create<HistogramState>((set) => ({
    data: null,
    mode: 'rgb',
    setData: (data) => set({ data }),
    cycleMode: () => set((state) => ({ mode: MODE_ORDER[(MODE_ORDER.indexOf(state.mode) + 1) % MODE_ORDER.length] })),
}))
