import { create } from 'zustand'
import type { ClippingMode, CompareSplit, EngineApi } from '../gl/engineApi'
import type { HslBand } from '../types/HslBand'
import type { EditSection } from './editDefaults'

export type CropOverlayStyle = 'thirds' | 'golden' | 'diag' | 'none'

const CROP_OVERLAY_ORDER: CropOverlayStyle[] = ['thirds', 'golden', 'diag', 'none']

type UiState = {
    engine: EngineApi | null
    panelVisible: boolean
    activeSection: EditSection
    clipping: ClippingMode
    compare: CompareSplit
    sideBySide: boolean
    cropEditMode: boolean
    cropOverlay: CropOverlayStyle
    eyedropper: boolean
    tatActive: boolean
    tatBand: HslBand | null
    attachEngine: (engine: EngineApi | null) => void
    togglePanel: () => void
    setActiveSection: (section: EditSection) => void
    toggleClipping: (target: Exclude<ClippingMode, 'none'>) => void
    toggleCompare: (axis: 'x' | 'y') => void
    toggleSideBySide: () => void
    setComparePosition: (position: number) => void
    resetComparePosition: () => void
    exitCompare: () => void
    setCropEditMode: (on: boolean) => void
    cycleCropOverlay: () => void
    setEyedropper: (on: boolean) => void
    toggleTat: () => void
    setTatBand: (band: HslBand | null) => void
}

export const useUiStore = create<UiState>((set, get) => ({
    engine: null,
    panelVisible: true,
    activeSection: 'basic',
    clipping: 'none',
    compare: null,
    sideBySide: false,
    cropEditMode: false,
    cropOverlay: 'thirds',
    eyedropper: false,
    tatActive: false,
    tatBand: null,
    attachEngine: (engine) => {
        set({ engine })
        if (!engine) return
        const state = get()
        engine.setClipping(state.clipping)
        engine.setCompare(state.compare)
        engine.setSideBySide(state.sideBySide)
        engine.setCropEditMode(state.cropEditMode)
    },
    togglePanel: () => set((state) => ({ panelVisible: !state.panelVisible })),
    setActiveSection: (section) => set({ activeSection: section }),
    toggleClipping: (target) =>
        set((state) => {
            const clipping: ClippingMode = state.clipping === target ? 'none' : target
            state.engine?.setClipping(clipping)
            return { clipping }
        }),
    toggleCompare: (axis) =>
        set((state) => {
            const compare: CompareSplit = state.compare && state.compare.axis === axis ? null : { axis, position: 0.5 }
            state.engine?.setCompare(compare)
            if (compare && state.sideBySide) state.engine?.setSideBySide(false)
            return { compare, sideBySide: compare ? false : state.sideBySide }
        }),
    toggleSideBySide: () =>
        set((state) => {
            const sideBySide = !state.sideBySide
            state.engine?.setSideBySide(sideBySide)
            if (sideBySide && state.compare) state.engine?.setCompare(null)
            return { sideBySide, compare: sideBySide ? null : state.compare }
        }),
    setComparePosition: (position) =>
        set((state) => {
            if (!state.compare) return state
            const clamped = position < 0 ? 0 : position > 1 ? 1 : position
            const compare: CompareSplit = { axis: state.compare.axis, position: clamped }
            state.engine?.setCompare(compare)
            return { compare }
        }),
    resetComparePosition: () =>
        set((state) => {
            if (!state.compare) return state
            const compare: CompareSplit = { axis: state.compare.axis, position: 0.5 }
            state.engine?.setCompare(compare)
            return { compare }
        }),
    exitCompare: () =>
        set((state) => {
            if (!state.compare) return state
            state.engine?.setCompare(null)
            return { compare: null }
        }),
    setCropEditMode: (on) =>
        set((state) => {
            state.engine?.setCropEditMode(on)
            return { cropEditMode: on }
        }),
    cycleCropOverlay: () =>
        set((state) => {
            const index = CROP_OVERLAY_ORDER.indexOf(state.cropOverlay)
            return { cropOverlay: CROP_OVERLAY_ORDER[(index + 1) % CROP_OVERLAY_ORDER.length] }
        }),
    setEyedropper: (on) => set({ eyedropper: on }),
    toggleTat: () => set((state) => (state.tatActive ? { tatActive: false, tatBand: null } : { tatActive: true, eyedropper: false })),
    setTatBand: (band) => set({ tatBand: band }),
}))
