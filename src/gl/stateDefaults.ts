import { isGeometryNeutral } from './geometry'
import { isCurvesNeutral } from './toneCurveLut'
import type { ColorState } from '../types/ColorState'
import type { DetailState } from '../types/DetailState'
import type { EditState } from '../types/EditState'
import type { EffectsState } from '../types/EffectsState'
import type { HslBand } from '../types/HslBand'
import type { ToneState } from '../types/ToneState'

export const HSL_BANDS: HslBand[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']

export const HSL_BAND_HUE: Record<HslBand, number> = { red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 240, purple: 280, magenta: 320 }

const identityCurve = () => [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
]

export const NEUTRAL_EDIT_STATE: EditState = {
    version: 2,
    wb: { mode: 'as-shot', temp: 6500, tint: 0, tempShift: null },
    lens: { autoProfile: true, profileId: null, distortion: 100, tca: 100, vignette: 100, manualVignette: 0, manualDistortion: 0 },
    geometry: {
        rotate90: 0,
        flipH: false,
        flipV: false,
        straighten: 0,
        perspectiveV: 0,
        perspectiveH: 0,
        perspectiveRotate: 0,
        aspectAdjust: 0,
        scale: 100,
        offsetX: 0,
        offsetY: 0,
    },
    crop: null,
    scan: null,
    drawer: null,
    tone: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, highlightRecovery: 0 },
    baseCurve: 'standard',
    curves: { rgb: identityCurve(), red: identityCurve(), green: identityCurve(), blue: identityCurve() },
    color: {
        vibrance: 0,
        saturation: 0,
        bw: false,
        hsl: {
            red: { hue: 0, sat: 0, lum: 0 },
            orange: { hue: 0, sat: 0, lum: 0 },
            yellow: { hue: 0, sat: 0, lum: 0 },
            green: { hue: 0, sat: 0, lum: 0 },
            aqua: { hue: 0, sat: 0, lum: 0 },
            blue: { hue: 0, sat: 0, lum: 0 },
            purple: { hue: 0, sat: 0, lum: 0 },
            magenta: { hue: 0, sat: 0, lum: 0 },
        },
    },
    detail: {
        sharpenAmount: 0,
        sharpenRadius: 1,
        sharpenDetail: 25,
        sharpenMasking: 0,
        nrLuminance: 0,
        nrLumaDetail: 50,
        nrLumaContrast: 0,
        nrColor: 0,
        nrColorDetail: 50,
        hotPixelRemoval: true,
    },
    effects: {
        clarity: 0,
        dehaze: 0,
        vignetteAmount: 0,
        vignetteMidpoint: 50,
        vignetteRoundness: 0,
        vignetteFeather: 50,
        grainAmount: 0,
        grainSize: 0,
        grainRoughness: 0,
    },
    meta: { appliedPreset: null, modifiedAt: 0 },
}

export const isToneNeutral = (tone: ToneState) =>
    tone.exposure === 0 &&
    tone.contrast === 0 &&
    tone.highlights === 0 &&
    tone.shadows === 0 &&
    tone.whites === 0 &&
    tone.blacks === 0 &&
    tone.highlightRecovery === 0

export const isColorNeutral = (color: ColorState) => {
    if (color.vibrance !== 0 || color.saturation !== 0 || color.bw) return false
    for (const band of HSL_BANDS) {
        const adjust = color.hsl[band]
        if (adjust && (adjust.hue !== 0 || adjust.sat !== 0 || adjust.lum !== 0)) return false
    }
    return true
}

export const isDetailNeutral = (detail: DetailState) => detail.sharpenAmount === 0 && detail.nrLuminance === 0 && detail.nrColor === 0

export const isEffectsNeutral = (effects: EffectsState) =>
    effects.clarity === 0 && effects.dehaze === 0 && effects.vignetteAmount === 0 && effects.grainAmount === 0

export const isCurvePassActive = (state: EditState) => state.baseCurve !== 'linear' || !isCurvesNeutral(state.curves)

export const isGeometryPassActive = (state: EditState) => !isGeometryNeutral(state.geometry) || state.scan?.enabled === true
