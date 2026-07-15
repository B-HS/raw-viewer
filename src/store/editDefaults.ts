import type { CurvePoint } from '../types/CurvePoint'
import type { EditState } from '../types/EditState'
import type { HslBand } from '../types/HslBand'

export const HSL_BANDS: HslBand[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']

const identityCurve = (): CurvePoint[] => [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
]

export const DEFAULT_EDIT_STATE: EditState = {
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
    tone: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, highlightRecovery: 0 },
    baseCurve: 'standard',
    curves: { rgb: identityCurve(), red: identityCurve(), green: identityCurve(), blue: identityCurve() },
    color: {
        vibrance: 0,
        saturation: 0,
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
        bw: false,
    },
    detail: {
        sharpenAmount: 25,
        sharpenRadius: 1,
        sharpenDetail: 25,
        sharpenMasking: 0,
        nrLuminance: 0,
        nrLumaDetail: 50,
        nrLumaContrast: 0,
        nrColor: 25,
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

const curveSignature = (points: CurvePoint[]) => points.map((point) => `${point.x},${point.y}`).join('|')

const stateSignature = (state: EditState) =>
    JSON.stringify([
        state.version,
        state.wb.mode,
        state.wb.temp,
        state.wb.tint,
        state.wb.tempShift,
        state.lens.autoProfile,
        state.lens.profileId,
        state.lens.distortion,
        state.lens.tca,
        state.lens.vignette,
        state.lens.manualVignette,
        state.lens.manualDistortion,
        state.geometry.rotate90,
        state.geometry.flipH,
        state.geometry.flipV,
        state.geometry.straighten,
        state.geometry.perspectiveV,
        state.geometry.perspectiveH,
        state.geometry.perspectiveRotate,
        state.geometry.aspectAdjust,
        state.geometry.scale,
        state.geometry.offsetX,
        state.geometry.offsetY,
        state.crop ? [state.crop.enabled, state.crop.left, state.crop.top, state.crop.right, state.crop.bottom, state.crop.aspect] : null,
        state.tone.exposure,
        state.tone.contrast,
        state.tone.highlights,
        state.tone.shadows,
        state.tone.whites,
        state.tone.blacks,
        state.tone.highlightRecovery,
        state.baseCurve,
        curveSignature(state.curves.rgb),
        curveSignature(state.curves.red),
        curveSignature(state.curves.green),
        curveSignature(state.curves.blue),
        state.color.vibrance,
        state.color.saturation,
        state.color.bw,
        HSL_BANDS.map((band) => {
            const adjust = state.color.hsl[band]
            return [adjust?.hue ?? 0, adjust?.sat ?? 0, adjust?.lum ?? 0]
        }),
        state.detail.sharpenAmount,
        state.detail.sharpenRadius,
        state.detail.sharpenDetail,
        state.detail.sharpenMasking,
        state.detail.nrLuminance,
        state.detail.nrLumaDetail,
        state.detail.nrLumaContrast,
        state.detail.nrColor,
        state.detail.nrColorDetail,
        state.detail.hotPixelRemoval,
        state.effects.clarity,
        state.effects.dehaze,
        state.effects.vignetteAmount,
        state.effects.vignetteMidpoint,
        state.effects.vignetteRoundness,
        state.effects.vignetteFeather,
        state.effects.grainAmount,
        state.effects.grainSize,
        state.effects.grainRoughness,
    ])

const DEFAULT_SIGNATURE = stateSignature(DEFAULT_EDIT_STATE)

export const isDefault = (state: EditState) => stateSignature(state) === DEFAULT_SIGNATURE

export type EditSection = 'basic' | 'tone-curve' | 'hsl' | 'detail' | 'effects' | 'crop'

export const cloneDefaultSection = (section: EditSection, state: EditState): EditState => {
    const next: EditState = { ...state }
    if (section === 'basic') {
        next.wb = { ...DEFAULT_EDIT_STATE.wb, tempShift: state.wb.tempShift === null ? null : 0 }
        next.tone = { ...DEFAULT_EDIT_STATE.tone }
        next.color = { ...state.color, vibrance: 0, saturation: 0 }
    } else if (section === 'tone-curve') {
        next.baseCurve = DEFAULT_EDIT_STATE.baseCurve
        next.curves = { rgb: identityCurve(), red: identityCurve(), green: identityCurve(), blue: identityCurve() }
    } else if (section === 'hsl') {
        next.color = {
            ...state.color,
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
        }
    } else if (section === 'detail') {
        next.detail = { ...DEFAULT_EDIT_STATE.detail }
    } else if (section === 'effects') {
        next.effects = { ...DEFAULT_EDIT_STATE.effects }
    } else {
        next.geometry = { ...DEFAULT_EDIT_STATE.geometry }
        next.lens = { ...DEFAULT_EDIT_STATE.lens }
        next.crop = null
    }
    return next
}
