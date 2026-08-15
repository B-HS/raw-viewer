import { HSL_BANDS, isColorNeutral, isCurvePassActive, isDetailNeutral, isEffectsNeutral, isGeometryPassActive, isToneNeutral } from './stateDefaults'
import type { CurvesState } from '../types/CurvesState'
import type { EditState } from '../types/EditState'

export const STAGE_WB = 0
export const STAGE_GEOMETRY = 1
export const STAGE_TONE = 2
export const STAGE_CURVE = 3
export const STAGE_COLOR = 4
export const STAGE_DETAIL = 5
export const STAGE_EFFECTS = 6
export const STAGE_COUNT = 7
export const STAGE_NONE = STAGE_COUNT

export const stageActive = (stage: number, state: EditState) => {
    if (stage === STAGE_WB) return true
    if (stage === STAGE_GEOMETRY) return isGeometryPassActive(state)
    if (stage === STAGE_TONE) return !isToneNeutral(state.tone)
    if (stage === STAGE_CURVE) return isCurvePassActive(state)
    if (stage === STAGE_COLOR) return !isColorNeutral(state.color)
    if (stage === STAGE_DETAIL) return !isDetailNeutral(state.detail)
    return !isEffectsNeutral(state.effects)
}

const curvesEqual = (a: CurvesState, b: CurvesState) =>
    JSON.stringify(a.rgb) === JSON.stringify(b.rgb) &&
    JSON.stringify(a.red) === JSON.stringify(b.red) &&
    JSON.stringify(a.green) === JSON.stringify(b.green) &&
    JSON.stringify(a.blue) === JSON.stringify(b.blue)

const scanEqual = (a: EditState['scan'], b: EditState['scan']) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const stageParamsEqual = (stage: number, a: EditState, b: EditState) => {
    if (stage === STAGE_WB) return a.wb.temp === b.wb.temp && a.wb.tint === b.wb.tint && a.wb.tempShift === b.wb.tempShift
    if (stage === STAGE_GEOMETRY) {
        const x = a.geometry
        const y = b.geometry
        return (
            scanEqual(a.scan, b.scan) &&
            x.flipH === y.flipH &&
            x.flipV === y.flipV &&
            x.straighten === y.straighten &&
            x.perspectiveV === y.perspectiveV &&
            x.perspectiveH === y.perspectiveH &&
            x.perspectiveRotate === y.perspectiveRotate &&
            x.aspectAdjust === y.aspectAdjust &&
            x.scale === y.scale &&
            x.offsetX === y.offsetX &&
            x.offsetY === y.offsetY
        )
    }
    if (stage === STAGE_TONE) {
        const x = a.tone
        const y = b.tone
        return (
            x.exposure === y.exposure &&
            x.contrast === y.contrast &&
            x.highlights === y.highlights &&
            x.shadows === y.shadows &&
            x.whites === y.whites &&
            x.blacks === y.blacks &&
            x.highlightRecovery === y.highlightRecovery
        )
    }
    if (stage === STAGE_CURVE) return a.baseCurve === b.baseCurve && curvesEqual(a.curves, b.curves)
    if (stage === STAGE_COLOR) {
        if (a.color.vibrance !== b.color.vibrance || a.color.saturation !== b.color.saturation || a.color.bw !== b.color.bw) return false
        for (const band of HSL_BANDS) {
            const x = a.color.hsl[band]
            const y = b.color.hsl[band]
            if ((x?.hue ?? 0) !== (y?.hue ?? 0) || (x?.sat ?? 0) !== (y?.sat ?? 0) || (x?.lum ?? 0) !== (y?.lum ?? 0)) return false
        }
        return true
    }
    if (stage === STAGE_DETAIL) {
        const x = a.detail
        const y = b.detail
        return (
            x.sharpenAmount === y.sharpenAmount &&
            x.sharpenRadius === y.sharpenRadius &&
            x.sharpenDetail === y.sharpenDetail &&
            x.sharpenMasking === y.sharpenMasking &&
            x.nrLuminance === y.nrLuminance &&
            x.nrLumaDetail === y.nrLumaDetail &&
            x.nrLumaContrast === y.nrLumaContrast &&
            x.nrColor === y.nrColor &&
            x.nrColorDetail === y.nrColorDetail
        )
    }
    const x = a.effects
    const y = b.effects
    return (
        x.clarity === y.clarity &&
        x.dehaze === y.dehaze &&
        x.vignetteAmount === y.vignetteAmount &&
        x.vignetteMidpoint === y.vignetteMidpoint &&
        x.vignetteRoundness === y.vignetteRoundness &&
        x.vignetteFeather === y.vignetteFeather &&
        x.grainAmount === y.grainAmount &&
        x.grainSize === y.grainSize &&
        x.grainRoughness === y.grainRoughness
    )
}

export const earliestDirtyStage = (prev: EditState, next: EditState) => {
    for (let stage = 0; stage < STAGE_COUNT; stage++) {
        if (stageActive(stage, prev) !== stageActive(stage, next)) return stage
        if (stageActive(stage, next) && !stageParamsEqual(stage, prev, next)) return stage
    }
    return STAGE_NONE
}
