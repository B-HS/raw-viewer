import { createExportEngine } from '../exportRenderer'
import { floatToHalf, halfToFloat } from '../half'
import { nrUniforms } from '../passUniforms'
import { NEUTRAL_EDIT_STATE } from '../stateDefaults'
import { NR_COMPUTE_RADIUS, NR_COMPUTE_SIGMA_SPATIAL } from './wgsl'
import { WebGpuRenderer } from './webgpuRenderer'
import type { EditState } from '../../types/EditState'
import type { LensProfileMatch } from '../../types/LensProfileMatch'

const SOURCE_W = 128
const SOURCE_H = 96
const REPORT_URL = 'http://localhost:14211/parity-report'

const report = (text: string) => fetch(REPORT_URL, { method: 'POST', body: text }).catch(() => undefined)
const MAX_DIFF_LIMIT = 0.012
const MEAN_DIFF_LIMIT = 0.002
const GRAIN_MAX_DIFF_LIMIT = 0.5

type Vector = {
    name: string
    flip: number
    colorMatrix: number[] | null
    lensProfile: LensProfileMatch | null
    state: EditState
    maxLimit?: number
    reference?: 'nr'
}

const cloneState = () => structuredClone(NEUTRAL_EDIT_STATE)

const makeSource = () => {
    const data = new Uint16Array(SOURCE_W * SOURCE_H * 3)
    for (let y = 0; y < SOURCE_H; y++) {
        for (let x = 0; x < SOURCE_W; x++) {
            const index = (y * SOURCE_W + x) * 3
            const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 0.15 : 0
            data[index] = floatToHalf((x / (SOURCE_W - 1)) * 1.6 + checker)
            data[index + 1] = floatToHalf((y / (SOURCE_H - 1)) * 1.2 + checker * 0.5)
            data[index + 2] = floatToHalf(((x + y) % 32) / 32 + checker)
        }
    }
    return data
}

const CAMERA_MATRIX = [0.9, 0.08, 0.02, 0.05, 0.85, 0.1, 0.01, 0.12, 0.87]

const LUMA = [0.2627, 0.678, 0.0593]

const nrReference = (source: Uint16Array, width: number, height: number, state: EditState) => {
    const n = nrUniforms(state.detail)
    const rgb = new Float32Array(width * height * 3)
    for (let i = 0; i < rgb.length; i++) rgb[i] = halfToFloat(source[i])
    const out = new Uint16Array(width * height * 4)
    const thr = 0.05 + (0.004 - 0.05) * n.nrLumaDetail
    const cthr = 0.2 + (0.02 - 0.2) * n.nrColorDetail
    const lumaOf = (index: number) => rgb[index] * LUMA[0] + rgb[index + 1] * LUMA[1] + rgb[index + 2] * LUMA[2]
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const center = (y * width + x) * 3
            const y0 = lumaOf(center)
            const chroma0 = [rgb[center] - y0, rgb[center + 1] - y0, rgb[center + 2] - y0]
            let sumY = 0
            let sumW = 0
            const sumC = [0, 0, 0]
            let sumCW = 0
            for (let dy = -NR_COMPUTE_RADIUS; dy <= NR_COMPUTE_RADIUS; dy++) {
                for (let dx = -NR_COMPUTE_RADIUS; dx <= NR_COMPUTE_RADIUS; dx++) {
                    const sx = Math.min(width - 1, Math.max(0, x + dx))
                    const sy = Math.min(height - 1, Math.max(0, y + dy))
                    const s = (sy * width + sx) * 3
                    const ys = lumaOf(s)
                    const sw = Math.exp(-(dx * dx + dy * dy) / (2 * NR_COMPUTE_SIGMA_SPATIAL * NR_COMPUTE_SIGMA_SPATIAL))
                    const rw = Math.exp(-((ys - y0) * (ys - y0)) / (2 * thr * thr)) * sw
                    sumY += ys * rw
                    sumW += rw
                    const cs = [rgb[s] - ys, rgb[s + 1] - ys, rgb[s + 2] - ys]
                    const dc0 = cs[0] - chroma0[0]
                    const dc1 = cs[1] - chroma0[1]
                    const dc2 = cs[2] - chroma0[2]
                    const cw = Math.exp(-(dc0 * dc0 + dc1 * dc1 + dc2 * dc2) / (2 * cthr * cthr)) * sw
                    sumC[0] += cs[0] * cw
                    sumC[1] += cs[1] * cw
                    sumC[2] += cs[2] * cw
                    sumCW += cw
                }
            }
            const yd = sumY / sumW
            let ynew = y0 + (yd - y0) * n.nrLuma
            ynew = ynew + (y0 - ynew) * (n.nrLumaContrast * (1 - n.nrLuma) * 0.5)
            const outIndex = (y * width + x) * 4
            for (let ch = 0; ch < 3; ch++) {
                const chroma = chroma0[ch] + (sumC[ch] / sumCW - chroma0[ch]) * n.nrColor
                out[outIndex + ch] = floatToHalf(Math.max(ynew + chroma, 0))
            }
            out[outIndex + 3] = floatToHalf(1)
        }
    }
    return { width, height, data: out }
}

const LENS_PROFILE: LensProfileMatch = {
    profileId: 'parity-lens',
    lensName: 'Parity 50mm',
    distortion: { model: 'poly3', coeffs: [0.06] },
    tca: { model: 'poly3', coeffs: [1.0015, 0.9985, 0.0006, -0.0004, 0, 0] },
    vignetting: { coeffs: [-0.35, 0.12, -0.02] },
}

const buildVectors = (): Vector[] => {
    const vectors: Vector[] = []
    const push = (
        name: string,
        mutate: (state: EditState) => void,
        extra?: Partial<Pick<Vector, 'flip' | 'colorMatrix' | 'lensProfile' | 'maxLimit' | 'reference'>>,
    ) => {
        const state = cloneState()
        mutate(state)
        vectors.push({ name, flip: 0, colorMatrix: null, lensProfile: null, state, ...extra })
    }
    push('neutral', () => undefined)
    push('camera-matrix', () => undefined, { colorMatrix: CAMERA_MATRIX })
    push('wb', (state) => {
        state.wb = { mode: 'custom', temp: 8200, tint: -40, tempShift: null }
    })
    push('tone', (state) => {
        state.tone = { exposure: 0.7, contrast: 35, highlights: -50, shadows: 40, whites: 20, blacks: -25, highlightRecovery: 60 }
    })
    push('curve', (state) => {
        state.baseCurve = 'filmic'
        state.curves.rgb = [
            { x: 0, y: 0.05 },
            { x: 0.4, y: 0.35 },
            { x: 1, y: 0.95 },
        ]
        state.curves.red = [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.6 },
            { x: 1, y: 1 },
        ]
    })
    push('hsl', (state) => {
        state.color.vibrance = 40
        state.color.saturation = 15
        state.color.hsl.red = { hue: 20, sat: 30, lum: -10 }
        state.color.hsl.blue = { hue: -15, sat: 25, lum: 20 }
    })
    push('bw', (state) => {
        state.color.bw = true
        state.color.hsl.red = { hue: 0, sat: 0, lum: 30 }
    })
    push('geometry', (state) => {
        state.geometry.straighten = 4
        state.geometry.perspectiveV = 20
        state.geometry.scale = 110
        state.geometry.flipH = true
    })
    push('lens-manual', (state) => {
        state.lens.autoProfile = false
        state.lens.manualDistortion = 30
        state.lens.manualVignette = -40
    })
    push('lens-profile', () => undefined, { lensProfile: LENS_PROFILE })
    push('sharpen', (state) => {
        state.detail.sharpenAmount = 60
        state.detail.sharpenRadius = 1.5
        state.detail.sharpenMasking = 30
    })
    push(
        'nr-compute',
        (state) => {
            state.baseCurve = 'linear'
            state.detail.nrLuminance = 60
            state.detail.nrColor = 50
            state.detail.nrLumaDetail = 50
            state.detail.nrColorDetail = 50
            state.detail.nrLumaContrast = 20
        },
        { reference: 'nr' },
    )
    push('effects', (state) => {
        state.effects.clarity = 40
        state.effects.dehaze = 25
        state.effects.vignetteAmount = -45
        state.effects.vignetteMidpoint = 40
        state.effects.vignetteFeather = 60
    })
    push(
        'grain',
        (state) => {
            state.effects.grainAmount = 50
            state.effects.grainSize = 40
            state.effects.grainRoughness = 50
        },
        { maxLimit: GRAIN_MAX_DIFF_LIMIT },
    )
    push('flip3', () => undefined, { flip: 3 })
    push('flip5', () => undefined, { flip: 5 })
    push('flip6', () => undefined, { flip: 6 })
    push('combined', (state) => {
        state.wb = { mode: 'custom', temp: 5200, tint: 20, tempShift: null }
        state.tone.exposure = 0.4
        state.tone.contrast = 20
        state.color.vibrance = 25
        state.geometry.straighten = -3
        state.detail.sharpenAmount = 40
        state.effects.vignetteAmount = -30
    })
    return vectors
}

const collectWebGl = async (source: Uint16Array, vector: Vector) => {
    const engine = createExportEngine()
    const job = engine.prepare(
        { width: SOURCE_W, height: SOURCE_H, data: source, colorMatrix: vector.colorMatrix, flip: vector.flip },
        vector.state,
        vector.lensProfile,
    )
    const out = new Uint16Array(job.width * job.height * 4)
    await job.stream(
        async (tile) => {
            for (let row = 0; row < tile.height; row++) {
                out.set(tile.data.subarray(row * tile.width * 4, (row + 1) * tile.width * 4), ((tile.y + row) * job.width + tile.x) * 4)
            }
        },
        () => false,
    )
    job.release()
    engine.dispose()
    return { width: job.width, height: job.height, data: out }
}

const compare = (a: Uint16Array, b: Uint16Array, width: number) => {
    let maxDiff = 0
    let sum = 0
    let count = 0
    let worst = ''
    for (let i = 0; i < a.length; i += 4) {
        for (let ch = 0; ch < 3; ch++) {
            const va = halfToFloat(a[i + ch])
            const vb = halfToFloat(b[i + ch])
            const diff = Math.abs(va - vb)
            if (diff > maxDiff) {
                maxDiff = diff
                const pixel = i / 4
                worst = `@(${pixel % width},${Math.floor(pixel / width)})ch${ch} ref=${va.toFixed(4)} got=${vb.toFixed(4)}`
            }
            sum += diff
            count++
        }
    }
    return { maxDiff, meanDiff: sum / count, worst }
}

const run = async () => {
    const out = document.getElementById('out')
    if (!out) return
    const lines: string[] = []
    const emit = (line: string) => {
        lines.push(line)
        out.textContent = lines.join('\n')
    }
    const originalConsoleError = console.error
    console.error = (...args: unknown[]) => {
        originalConsoleError(...args)
        emit(`CONSOLE: ${args.map((item) => String(item)).join(' ')}`)
    }
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    let gpu: WebGpuRenderer
    try {
        gpu = await WebGpuRenderer.create(canvas)
    } catch (error) {
        emit(`PARITY: SKIP (webgpu unavailable: ${error instanceof Error ? error.message : 'unknown'})`)
        document.title = 'parity: skip'
        await report(lines.join('\n'))
        return
    }
    const source = makeSource()
    let failures = 0
    for (const vector of buildVectors()) {
        try {
            const reference = vector.reference === 'nr' ? nrReference(source, SOURCE_W, SOURCE_H, vector.state) : await collectWebGl(source, vector)
            const candidate = await gpu.renderExport(
                { width: SOURCE_W, height: SOURCE_H, data: source, colorMatrix: vector.colorMatrix, flip: vector.flip },
                vector.state,
                vector.lensProfile,
            )
            if (reference.width !== candidate.width || reference.height !== candidate.height) {
                failures++
                emit(`FAIL ${vector.name} size ${reference.width}x${reference.height} vs ${candidate.width}x${candidate.height}`)
                continue
            }
            const { maxDiff, meanDiff, worst } = compare(reference.data, candidate.data, reference.width)
            const maxLimit = vector.maxLimit ?? MAX_DIFF_LIMIT
            const meanLimit = vector.maxLimit != null ? vector.maxLimit : MEAN_DIFF_LIMIT
            const pass = maxDiff <= maxLimit && meanDiff <= meanLimit
            if (!pass) failures++
            emit(`${pass ? 'PASS' : 'FAIL'} ${vector.name} max=${maxDiff.toFixed(5)} mean=${meanDiff.toFixed(6)}${pass ? '' : ` ${worst}`}`)
            if (!pass) {
                for (const [px, py] of [
                    [0, 0],
                    [16, 0],
                    [64, 0],
                    [120, 0],
                    [126, 0],
                    [127, 0],
                    [0, 16],
                    [0, 48],
                    [0, 92],
                    [0, 95],
                    [64, 48],
                    [127, 93],
                ]) {
                    const base = (py * reference.width + px) * 4
                    const fmt = (arr: Uint16Array) => [0, 1, 2].map((ch) => halfToFloat(arr[base + ch]).toFixed(4)).join(',')
                    emit(`  px(${px},${py}) ref=[${fmt(reference.data)}] got=[${fmt(candidate.data)}]`)
                }
            }
        } catch (error) {
            failures++
            emit(`FAIL ${vector.name} error=${error instanceof Error ? error.message : 'unknown'}`)
        }
    }
    gpu.dispose()
    const summary = failures === 0 ? `PARITY: ALL PASS (${buildVectors().length} vectors)` : `PARITY: ${failures} FAIL`
    emit(summary)
    document.title = failures === 0 ? 'parity: pass' : 'parity: fail'
    await report(lines.join('\n'))
}

run().catch((error) => {
    const message = `PARITY: HARNESS ERROR ${error instanceof Error ? (error.stack ?? error.message) : 'unknown'}`
    const out = document.getElementById('out')
    if (out) out.textContent = message
    document.title = 'parity: error'
    report(message)
})
