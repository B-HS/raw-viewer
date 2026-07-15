import { create } from 'zustand'

type ViewportProjectionState = {
    model: Float32Array | null
    clientW: number
    clientH: number
    imageId: string | null
    nonce: number
    publish: (model: Float32Array, clientW: number, clientH: number, imageId: string) => void
    clear: () => void
}

export const useViewportProjection = create<ViewportProjectionState>((set) => ({
    model: null,
    clientW: 0,
    clientH: 0,
    imageId: null,
    nonce: 0,
    publish: (model, clientW, clientH, imageId) => set((state) => ({ model, clientW, clientH, imageId, nonce: state.nonce + 1 })),
    clear: () => set((state) => (state.model === null ? state : { model: null, imageId: null, nonce: state.nonce + 1 })),
}))
