import { tempTintFromGains, wbGainsFromState } from './wbModel'
import type { Renderer } from './renderer'
import type { EditState } from '../types/EditState'
import type { LensProfileMatch } from '../types/LensProfileMatch'
import type { WbState } from '../types/WbState'

export type ClippingMode = 'none' | 'both' | 'highlight' | 'shadow'

export type CompareSplit = { axis: 'x' | 'y'; position: number } | null

export type EngineApi = {
    setEditState: (state: EditState | null) => void
    setLensProfile: (imageId: string | null, profile: LensProfileMatch | null) => void
    setClipping: (mode: ClippingMode) => void
    setCompare: (split: CompareSplit) => void
    setCropEditMode: (on: boolean) => void
    onHistogram: (cb: (hist: { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array }) => void) => () => void
    samplePixel: (canvasX: number, canvasY: number) => { r: number; g: number; b: number } | null
    wbGainsFromState: (wb: WbState) => [number, number, number]
    tempTintFromGains: (gains: [number, number, number]) => { temp: number; tint: number }
}

export const createEngineApi = (renderer: Renderer, requestRender: () => void): EngineApi => ({
    setEditState: (state) => {
        renderer.setEditState(state)
        requestRender()
    },
    setLensProfile: (imageId, profile) => {
        renderer.setLensProfile(imageId, profile)
        requestRender()
    },
    setClipping: (mode) => {
        renderer.setClipping(mode)
        requestRender()
    },
    setCompare: (split) => {
        renderer.setCompare(split)
        requestRender()
    },
    setCropEditMode: (on) => {
        renderer.setCropEditMode(on)
        requestRender()
    },
    onHistogram: (cb) => renderer.onHistogram(cb),
    samplePixel: (canvasX, canvasY) => renderer.samplePixel(canvasX, canvasY),
    wbGainsFromState: (wb) => wbGainsFromState(wb),
    tempTintFromGains: (gains) => tempTintFromGains(gains),
})
