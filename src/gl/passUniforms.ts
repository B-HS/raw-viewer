import { HSL_BANDS } from './stateDefaults'
import type { DetailState } from '../types/DetailState'
import type { EditState } from '../types/EditState'
import type { EffectsState } from '../types/EffectsState'
import type { ToneState } from '../types/ToneState'

export const toneUniforms = (tone: ToneState) => ({
    exposure: Math.pow(2, tone.exposure),
    highlightRecovery: tone.highlightRecovery / 100,
    highlights: tone.highlights / 100,
    shadows: tone.shadows / 100,
    whites: tone.whites / 100,
    blacks: tone.blacks / 100,
    contrastK: Math.pow(2, tone.contrast / 100),
})

export const hslUniforms = (color: EditState['color']) => {
    const hue = new Float32Array(8)
    const sat = new Float32Array(8)
    const lum = new Float32Array(8)
    for (let i = 0; i < HSL_BANDS.length; i++) {
        const adjust = color.hsl[HSL_BANDS[i]]
        hue[i] = (adjust?.hue ?? 0) / 100
        sat[i] = (adjust?.sat ?? 0) / 100
        lum[i] = (adjust?.lum ?? 0) / 100
    }
    return { hue, sat, lum, vibrance: color.vibrance / 100, saturation: color.saturation / 100, bw: color.bw ? 1 : 0 }
}

export const nrUniforms = (detail: DetailState) => ({
    nrLuma: detail.nrLuminance / 100,
    nrLumaDetail: detail.nrLumaDetail / 100,
    nrLumaContrast: detail.nrLumaContrast / 100,
    nrColor: detail.nrColor / 100,
    nrColorDetail: detail.nrColorDetail / 100,
})

export const sharpenUniforms = (detail: DetailState) => ({
    amount: detail.sharpenAmount / 100,
    radius: detail.sharpenRadius,
    detail: detail.sharpenDetail / 100,
    masking: detail.sharpenMasking / 100,
})

export const effectsUniforms = (effects: EffectsState) => ({
    clarity: effects.clarity / 100,
    dehaze: effects.dehaze / 100,
    vignetteAmount: effects.vignetteAmount / 100,
    vignetteMidpoint: effects.vignetteMidpoint,
    vignetteRoundness: effects.vignetteRoundness,
    vignetteFeather: effects.vignetteFeather,
    grainAmount: effects.grainAmount / 100,
    grainSize: effects.grainSize,
    grainRoughness: effects.grainRoughness,
})
