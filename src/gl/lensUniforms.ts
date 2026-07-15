import type { LensProfileMatch } from '../types/LensProfileMatch'
import type { LensState } from '../types/LensState'

export type LensPass = {
    hasProfile: boolean
    distModel: number
    distCoeffs: [number, number, number]
    distStrength: number
    hasTca: boolean
    tcaModel: number
    tcaR: [number, number, number]
    tcaB: [number, number, number]
    tcaStrength: number
    hasVig: boolean
    vigCoeffs: [number, number, number]
    vigStrength: number
    manualDist: number
    manualVig: number
}

const distModelId = (model: LensProfileMatch['distortion']['model']) => (model === 'poly5' ? 1 : model === 'ptlens' ? 2 : 0)

const distIsIdentity = (coeffs: number[]) => coeffs.every((value) => value === 0)

const tcaIsIdentity = (model: LensProfileMatch['tca']['model'], coeffs: number[]) =>
    model === 'linear'
        ? (coeffs[0] ?? 1) === 1 && (coeffs[1] ?? 1) === 1
        : (coeffs[0] ?? 1) === 1 &&
          (coeffs[1] ?? 1) === 1 &&
          (coeffs[2] ?? 0) === 0 &&
          (coeffs[3] ?? 0) === 0 &&
          (coeffs[4] ?? 0) === 0 &&
          (coeffs[5] ?? 0) === 0

export const buildLensPass = (lens: LensState, profile: LensProfileMatch | null): LensPass | null => {
    if (lens.autoProfile && profile) {
        const distStrength = lens.distortion / 100
        const tcaStrength = lens.tca / 100
        const vigStrength = lens.vignette / 100
        const distActive = distStrength > 0 && !distIsIdentity(profile.distortion.coeffs)
        const tcaActive = tcaStrength > 0 && !tcaIsIdentity(profile.tca.model, profile.tca.coeffs)
        const vigActive = vigStrength > 0 && profile.vignetting !== null
        if (!distActive && !tcaActive && !vigActive) return null
        const dc = profile.distortion.coeffs
        const tc = profile.tca.coeffs
        const linear = profile.tca.model === 'linear'
        const vc = profile.vignetting?.coeffs ?? [0, 0, 0]
        return {
            hasProfile: true,
            distModel: distModelId(profile.distortion.model),
            distCoeffs: [dc[0] ?? 0, dc[1] ?? 0, dc[2] ?? 0],
            distStrength: distActive ? distStrength : 0,
            hasTca: tcaActive,
            tcaModel: linear ? 0 : 1,
            tcaR: linear ? [tc[0] ?? 1, 0, 0] : [tc[0] ?? 1, tc[2] ?? 0, tc[4] ?? 0],
            tcaB: linear ? [tc[1] ?? 1, 0, 0] : [tc[1] ?? 1, tc[3] ?? 0, tc[5] ?? 0],
            tcaStrength,
            hasVig: vigActive,
            vigCoeffs: [vc[0] ?? 0, vc[1] ?? 0, vc[2] ?? 0],
            vigStrength,
            manualDist: 0,
            manualVig: 0,
        }
    }
    const manualDist = lens.manualDistortion / 100
    const manualVig = lens.manualVignette / 100
    if (manualDist === 0 && manualVig === 0) return null
    return {
        hasProfile: false,
        distModel: 0,
        distCoeffs: [0, 0, 0],
        distStrength: 0,
        hasTca: false,
        tcaModel: 0,
        tcaR: [1, 0, 0],
        tcaB: [1, 0, 0],
        tcaStrength: 0,
        hasVig: false,
        vigCoeffs: [0, 0, 0],
        vigStrength: 0,
        manualDist,
        manualVig,
    }
}

export const lensNormScale = (width: number, height: number): [number, number] => {
    const shortSide = Math.max(1, Math.min(width, height))
    return [(2 * width) / shortSide, (2 * height) / shortSide]
}

const LENS_PASS_UNIFORMS = [
    'uTexSize',
    'uLensNorm',
    'uLensActive',
    'uLensHasProfile',
    'uDistModel',
    'uDistCoeffs',
    'uDistStrength',
    'uLensHasTca',
    'uTcaModel',
    'uTcaR',
    'uTcaB',
    'uTcaStrength',
    'uLensHasVig',
    'uVigCoeffs',
    'uVigStrength',
    'uManualDist',
    'uManualVig',
]

export const PASS2_UNIFORMS = ['uTex', 'uWarp', ...LENS_PASS_UNIFORMS]

type Pass2Program = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }

export const applyLensUniforms = (gl: WebGL2RenderingContext, pass2: Pass2Program, pass: LensPass | null, width: number, height: number) => {
    gl.uniform2f(pass2.u.uTexSize, width, height)
    if (!pass) {
        gl.uniform1i(pass2.u.uLensActive, 0)
        return
    }
    const [normX, normY] = lensNormScale(width, height)
    gl.uniform1i(pass2.u.uLensActive, 1)
    gl.uniform2f(pass2.u.uLensNorm, normX, normY)
    gl.uniform1i(pass2.u.uLensHasProfile, pass.hasProfile ? 1 : 0)
    gl.uniform1i(pass2.u.uDistModel, pass.distModel)
    gl.uniform3f(pass2.u.uDistCoeffs, pass.distCoeffs[0], pass.distCoeffs[1], pass.distCoeffs[2])
    gl.uniform1f(pass2.u.uDistStrength, pass.distStrength)
    gl.uniform1i(pass2.u.uLensHasTca, pass.hasTca ? 1 : 0)
    gl.uniform1i(pass2.u.uTcaModel, pass.tcaModel)
    gl.uniform3f(pass2.u.uTcaR, pass.tcaR[0], pass.tcaR[1], pass.tcaR[2])
    gl.uniform3f(pass2.u.uTcaB, pass.tcaB[0], pass.tcaB[1], pass.tcaB[2])
    gl.uniform1f(pass2.u.uTcaStrength, pass.tcaStrength)
    gl.uniform1i(pass2.u.uLensHasVig, pass.hasVig ? 1 : 0)
    gl.uniform3f(pass2.u.uVigCoeffs, pass.vigCoeffs[0], pass.vigCoeffs[1], pass.vigCoeffs[2])
    gl.uniform1f(pass2.u.uVigStrength, pass.vigStrength)
    gl.uniform1f(pass2.u.uManualDist, pass.manualDist)
    gl.uniform1f(pass2.u.uManualVig, pass.manualVig)
}
