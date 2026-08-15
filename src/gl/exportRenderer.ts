import { buildBaseCurveLut } from './baseCurveLut'
import { IDENTITY3, SRGB_TO_REC2020, toColumnMajor } from './colorSpaces'
import { STAGE_COLOR, STAGE_COUNT, STAGE_CURVE, STAGE_DETAIL, STAGE_GEOMETRY, STAGE_TONE, STAGE_WB, stageActive } from './dirty'
import { buildGeometryWarp } from './geometry'
import { createProgram, uniformLocations } from './glContext'
import { floatToHalf } from './half'
import { applyLensUniforms, buildLensPass, PASS2_UNIFORMS } from './lensUniforms'
import { effectsUniforms, hslUniforms, nrUniforms, sharpenUniforms, toneUniforms } from './passUniforms'
import { floatRgbaToSrgbBytes, halfRgbaToSrgbBytes } from './photoConvert'
import { scanCornerArray, scanEdgeArray, scanOutputDims } from './scan'
import {
    FRAG_DRAWER,
    FRAG_NR,
    FRAG_PASS1,
    FRAG_PASS2,
    FRAG_PASS3,
    FRAG_PASS4,
    FRAG_PASS5,
    FRAG_PASS7,
    FRAG_SHARPEN,
    FRAG_TILE,
    VERT_FULLSCREEN,
    VERT_QUAD,
    VERT_TILE,
} from './shaders'
import { extractTile, planTiles, TILE_OVERLAP, TILE_SIZE } from './tiles'
import { buildToneCurveLut, TONE_LUT_SIZE } from './toneCurveLut'
import { composeFlip, dispDims, flipAngle } from './viewTransform'
import { wbGainsFromState } from './wbModel'
import type { DrawerPhoto } from './drawerRaster'
import type { LensPass } from './lensUniforms'
import type { EditState } from '../types/EditState'
import type { LensProfileMatch } from '../types/LensProfileMatch'

export type ExportSource = { width: number; height: number; data: Uint16Array; colorMatrix: number[] | null; flip: number }

export type ExportTileData = { x: number; y: number; width: number; height: number; data: Uint16Array }

export type ExportJob = {
    width: number
    height: number
    downscaled: boolean
    stream: (onTile: (tile: ExportTileData) => Promise<void>, shouldCancel: () => boolean) => Promise<boolean>
    release: () => void
}

export type ExportDrawerInput = HTMLCanvasElement | ((photo: DrawerPhoto) => HTMLCanvasElement | null) | null

export type ExportEngine = {
    prepare: (source: ExportSource, state: EditState, lensProfile: LensProfileMatch | null, drawer?: ExportDrawerInput) => ExportJob
    dispose: () => void
}

type ProgramInfo = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }

type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer }

const QUAD = new Float32Array([-1, 1, 0, 0, 1, 1, 1, 0, -1, -1, 0, 1, 1, -1, 1, 1])
const READBACK_TILE = 2048
const RAF_TILE_INTERVAL = 3

const FRAG_ORIENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 o;
void main() {
    o = vec4(texture(uTex, vUv).rgb, 1.0);
}
`

const raf = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const flipRows = (data: Uint16Array, width: number, height: number) => {
    const stride = width * 4
    const out = new Uint16Array(data.length)
    for (let row = 0; row < height; row++) out.set(data.subarray((height - 1 - row) * stride, (height - row) * stride), row * stride)
    return out
}

const orientModelMatrix = (ow: number, oh: number, flip: number) => {
    const theta = flipAngle(flip)
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    const swapped = flip === 5 || flip === 6
    const hx = (swapped ? oh : ow) / 2
    const hy = (swapped ? ow : oh) / 2
    const ox = 2 / ow
    const oy = 2 / oh
    return new Float32Array([cos * hx * ox, sin * hx * oy, 0, -sin * hy * ox, cos * hy * oy, 0, 0, 0, 1])
}

export const createExportEngine = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const gl = canvas.getContext('webgl2', {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('webgl2 unavailable')
    const floatBuffer = gl.getExtension('EXT_color_buffer_float')
    gl.getExtension('OES_texture_float_linear')
    if (!floatBuffer) throw new Error('float render target unsupported')
    const maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))
    const readType = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) === gl.HALF_FLOAT ? gl.HALF_FLOAT : gl.FLOAT
    const identityCol = toColumnMajor(IDENTITY3)

    const compile = (vertex: string, fragment: string, names: string[]) => {
        const program = createProgram(gl, vertex, fragment)
        return { program, u: uniformLocations(gl, program, names) }
    }

    const pass1 = compile(VERT_FULLSCREEN, FRAG_PASS1, ['uTex', 'uColorMatrix', 'uWbGain'])
    const pass2 = compile(VERT_FULLSCREEN, FRAG_PASS2, PASS2_UNIFORMS)
    const pass3 = compile(VERT_FULLSCREEN, FRAG_PASS3, [
        'uTex',
        'uExposure',
        'uHighlightRecovery',
        'uHighlights',
        'uShadows',
        'uWhites',
        'uBlacks',
        'uContrastK',
    ])
    const pass4 = compile(VERT_FULLSCREEN, FRAG_PASS4, ['uTex', 'uBase', 'uTone'])
    const pass5 = compile(VERT_FULLSCREEN, FRAG_PASS5, ['uTex', 'uHue', 'uSat', 'uLum', 'uVibrance', 'uSaturation', 'uBw'])
    const nr = compile(VERT_FULLSCREEN, FRAG_NR, ['uTex', 'uTexel', 'uNrLuma', 'uNrLumaDetail', 'uNrLumaContrast', 'uNrColor', 'uNrColorDetail'])
    const sharpen = compile(VERT_FULLSCREEN, FRAG_SHARPEN, ['uTex', 'uTexel', 'uAmount', 'uRadius', 'uDetail', 'uMasking'])
    const pass7 = compile(VERT_FULLSCREEN, FRAG_PASS7, [
        'uTex',
        'uTexel',
        'uClarity',
        'uDehaze',
        'uVignetteAmount',
        'uVignetteMidpoint',
        'uVignetteRoundness',
        'uVignetteFeather',
        'uGrainAmount',
        'uGrainSize',
        'uGrainRoughness',
        'uSeed',
    ])
    const tile = compile(VERT_TILE, FRAG_TILE, ['uModel', 'uTile', 'uSrcOrigin', 'uUvOffset', 'uUvScale'])
    const orient = compile(VERT_QUAD, FRAG_ORIENT, ['uTex', 'uModel'])
    const drawerPass = compile(VERT_FULLSCREEN, FRAG_DRAWER, ['uTex', 'uDrawerTex', 'uSrgbToRec2020'])

    const quadBuffer = gl.createBuffer()
    const vao = gl.createVertexArray()
    if (!quadBuffer || !vao) throw new Error('gl buffer alloc failed')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)
    gl.bindVertexArray(null)

    const createColorTexture = (width: number, height: number, internal: number, format: number, type: number, data: ArrayBufferView | null) => {
        const texture = gl.createTexture()
        if (!texture) throw new Error('gl texture alloc failed')
        gl.bindTexture(gl.TEXTURE_2D, texture)
        if (data) gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2)
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        return texture
    }

    const createTarget = (width: number, height: number) => {
        const tex = createColorTexture(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null)
        const fbo = gl.createFramebuffer()
        if (!fbo) throw new Error('gl fbo alloc failed')
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
        return { tex, fbo }
    }

    const createCurveTexture = (data: Uint8Array) => {
        const texture = gl.createTexture()
        if (!texture) throw new Error('gl curve alloc failed')
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, data.length, 1, 0, gl.RED, gl.UNSIGNED_BYTE, data)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        return texture
    }

    const createToneTexture = (data: Uint16Array) => {
        const texture = gl.createTexture()
        if (!texture) throw new Error('gl tone alloc failed')
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, TONE_LUT_SIZE, 1, 0, gl.RGBA, gl.HALF_FLOAT, data)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        return texture
    }

    const uploadSource = (source: ExportSource, renderW: number, renderH: number) => {
        if (source.width <= maxTexture && source.height <= maxTexture && renderW === source.width && renderH === source.height) {
            return createColorTexture(source.width, source.height, gl.RGB16F, gl.RGB, gl.HALF_FLOAT, source.data)
        }
        const proxy = createTarget(renderW, renderH)
        const tileCap = Math.min(TILE_SIZE, maxTexture)
        const tiles = planTiles(source.width, source.height, tileCap, TILE_OVERLAP)
        gl.bindFramebuffer(gl.FRAMEBUFFER, proxy.fbo)
        gl.viewport(0, 0, renderW, renderH)
        gl.disable(gl.BLEND)
        gl.bindVertexArray(vao)
        gl.useProgram(tile.program)
        gl.activeTexture(gl.TEXTURE0)
        for (const region of tiles) {
            const sub = extractTile(source.data, source.width, region)
            const texture = createColorTexture(region.texW, region.texH, gl.RGB16F, gl.RGB, gl.HALF_FLOAT, sub)
            const sx = region.coreW / source.width
            const sy = region.coreH / source.height
            const tx = (2 * region.sx0 + region.coreW) / source.width - 1
            const ty = (2 * region.sy0 + region.coreH) / source.height - 1
            gl.uniformMatrix3fv(tile.u.uModel, false, new Float32Array([sx, 0, 0, 0, sy, 0, tx, ty, 1]))
            gl.uniform1i(tile.u.uTile, 0)
            gl.uniform2f(tile.u.uSrcOrigin, region.sx0 / source.width, region.sy0 / source.height)
            gl.uniform2f(tile.u.uUvOffset, region.overlapL / region.texW, region.overlapT / region.texH)
            gl.uniform2f(tile.u.uUvScale, source.width / region.texW, source.height / region.texH)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
            gl.deleteTexture(texture)
        }
        gl.deleteFramebuffer(proxy.fbo)
        return proxy.tex
    }

    const runPasses = (
        sourceTex: WebGLTexture,
        source: ExportSource,
        w: number,
        h: number,
        state: EditState,
        baseLut: WebGLTexture,
        toneLut: WebGLTexture,
        lensPass: LensPass | null,
    ) => {
        const texel = new Float32Array([1 / w, 1 / h])
        const targets: Target[] = []
        const makeTarget = () => {
            const target = createTarget(w, h)
            targets.push(target)
            return target
        }
        const primary = makeTarget()
        const secondary = makeTarget()
        let scratch: Target | null = null
        gl.disable(gl.BLEND)
        gl.bindVertexArray(vao)

        const beginPass = (info: ProgramInfo, fbo: WebGLFramebuffer) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
            gl.viewport(0, 0, w, h)
            gl.useProgram(info.program)
            gl.activeTexture(gl.TEXTURE0)
        }

        const active: number[] = []
        for (let stage = 0; stage < STAGE_COUNT; stage++) {
            const on = stage === STAGE_GEOMETRY ? stageActive(stage, state) || lensPass !== null : stageActive(stage, state)
            if (on) active.push(stage)
        }

        let input = sourceTex
        let output = primary
        let last = sourceTex
        for (const id of active) {
            if (id === STAGE_WB) {
                beginPass(pass1, output.fbo)
                gl.bindTexture(gl.TEXTURE_2D, input)
                gl.uniform1i(pass1.u.uTex, 0)
                gl.uniformMatrix3fv(pass1.u.uColorMatrix, false, source.colorMatrix ? toColumnMajor(source.colorMatrix) : identityCol)
                gl.uniform3fv(pass1.u.uWbGain, wbGainsFromState(state.wb))
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
            } else if (id === STAGE_GEOMETRY) {
                beginPass(pass2, output.fbo)
                gl.bindTexture(gl.TEXTURE_2D, input)
                gl.uniform1i(pass2.u.uTex, 0)
                gl.uniformMatrix3fv(pass2.u.uWarp, false, buildGeometryWarp(state.geometry))
                const scan = state.scan
                const scanOn = scan !== null && scan.enabled
                gl.uniform1i(pass2.u.uScanOn, scanOn ? 1 : 0)
                if (scanOn && scan) {
                    gl.uniform2fv(pass2.u.uScanCorners, scanCornerArray(scan))
                    gl.uniform2fv(pass2.u.uScanEdges, scanEdgeArray(scan))
                }
                applyLensUniforms(gl, pass2, lensPass, w, h)
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
            } else if (id === STAGE_TONE) {
                const t = toneUniforms(state.tone)
                beginPass(pass3, output.fbo)
                gl.bindTexture(gl.TEXTURE_2D, input)
                gl.uniform1i(pass3.u.uTex, 0)
                gl.uniform1f(pass3.u.uExposure, t.exposure)
                gl.uniform1f(pass3.u.uHighlightRecovery, t.highlightRecovery)
                gl.uniform1f(pass3.u.uHighlights, t.highlights)
                gl.uniform1f(pass3.u.uShadows, t.shadows)
                gl.uniform1f(pass3.u.uWhites, t.whites)
                gl.uniform1f(pass3.u.uBlacks, t.blacks)
                gl.uniform1f(pass3.u.uContrastK, t.contrastK)
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
            } else if (id === STAGE_CURVE) {
                beginPass(pass4, output.fbo)
                gl.bindTexture(gl.TEXTURE_2D, input)
                gl.uniform1i(pass4.u.uTex, 0)
                gl.activeTexture(gl.TEXTURE1)
                gl.bindTexture(gl.TEXTURE_2D, baseLut)
                gl.uniform1i(pass4.u.uBase, 1)
                gl.activeTexture(gl.TEXTURE2)
                gl.bindTexture(gl.TEXTURE_2D, toneLut)
                gl.uniform1i(pass4.u.uTone, 2)
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
            } else if (id === STAGE_COLOR) {
                const c = hslUniforms(state.color)
                beginPass(pass5, output.fbo)
                gl.bindTexture(gl.TEXTURE_2D, input)
                gl.uniform1i(pass5.u.uTex, 0)
                gl.uniform1fv(pass5.u.uHue, c.hue)
                gl.uniform1fv(pass5.u.uSat, c.sat)
                gl.uniform1fv(pass5.u.uLum, c.lum)
                gl.uniform1f(pass5.u.uVibrance, c.vibrance)
                gl.uniform1f(pass5.u.uSaturation, c.saturation)
                gl.uniform1i(pass5.u.uBw, c.bw)
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
            } else if (id === STAGE_DETAIL) {
                const detail = state.detail
                const nrActive = detail.nrLuminance > 0 || detail.nrColor > 0
                const sharpenActive = detail.sharpenAmount > 0
                let stageInput = input
                if (nrActive) {
                    if (sharpenActive && !scratch) scratch = makeTarget()
                    const dst = sharpenActive && scratch ? scratch : output
                    const n = nrUniforms(detail)
                    beginPass(nr, dst.fbo)
                    gl.bindTexture(gl.TEXTURE_2D, stageInput)
                    gl.uniform1i(nr.u.uTex, 0)
                    gl.uniform2fv(nr.u.uTexel, texel)
                    gl.uniform1f(nr.u.uNrLuma, n.nrLuma)
                    gl.uniform1f(nr.u.uNrLumaDetail, n.nrLumaDetail)
                    gl.uniform1f(nr.u.uNrLumaContrast, n.nrLumaContrast)
                    gl.uniform1f(nr.u.uNrColor, n.nrColor)
                    gl.uniform1f(nr.u.uNrColorDetail, n.nrColorDetail)
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
                    stageInput = dst.tex
                }
                if (sharpenActive) {
                    const s = sharpenUniforms(detail)
                    beginPass(sharpen, output.fbo)
                    gl.bindTexture(gl.TEXTURE_2D, stageInput)
                    gl.uniform1i(sharpen.u.uTex, 0)
                    gl.uniform2fv(sharpen.u.uTexel, texel)
                    gl.uniform1f(sharpen.u.uAmount, s.amount)
                    gl.uniform1f(sharpen.u.uRadius, s.radius)
                    gl.uniform1f(sharpen.u.uDetail, s.detail)
                    gl.uniform1f(sharpen.u.uMasking, s.masking)
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
                }
            } else {
                const e = effectsUniforms(state.effects)
                beginPass(pass7, output.fbo)
                gl.bindTexture(gl.TEXTURE_2D, input)
                gl.uniform1i(pass7.u.uTex, 0)
                gl.uniform2fv(pass7.u.uTexel, texel)
                gl.uniform1f(pass7.u.uClarity, e.clarity)
                gl.uniform1f(pass7.u.uDehaze, e.dehaze)
                gl.uniform1f(pass7.u.uVignetteAmount, e.vignetteAmount)
                gl.uniform1f(pass7.u.uVignetteMidpoint, e.vignetteMidpoint)
                gl.uniform1f(pass7.u.uVignetteRoundness, e.vignetteRoundness)
                gl.uniform1f(pass7.u.uVignetteFeather, e.vignetteFeather)
                gl.uniform1f(pass7.u.uGrainAmount, e.grainAmount)
                gl.uniform1f(pass7.u.uGrainSize, e.grainSize)
                gl.uniform1f(pass7.u.uGrainRoughness, e.grainRoughness)
                gl.uniform1f(pass7.u.uSeed, 1.0)
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
            }
            last = output.tex
            input = output.tex
            output = output === primary ? secondary : primary
        }
        return { finalTex: last, targets }
    }

    const readTexturePhoto = (texture: WebGLTexture, width: number, height: number): DrawerPhoto | null => {
        const fbo = gl.createFramebuffer()
        if (!fbo) return null
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
        const pixelCount = width * height
        let data: Uint8ClampedArray<ArrayBuffer>
        if (readType === gl.HALF_FLOAT) {
            const raw = new Uint16Array(pixelCount * 4)
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.HALF_FLOAT, raw)
            data = halfRgbaToSrgbBytes(raw, pixelCount)
        } else {
            const raw = new Float32Array(pixelCount * 4)
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, raw)
            data = floatRgbaToSrgbBytes(raw, pixelCount)
        }
        gl.deleteFramebuffer(fbo)
        return { data, width, height }
    }

    const prepare = (source: ExportSource, state: EditState, lensProfile: LensProfileMatch | null, drawer?: ExportDrawerInput) => {
        const longEdge = Math.max(source.width, source.height)
        const scale = longEdge > maxTexture ? maxTexture / longEdge : 1
        const renderW = Math.max(1, Math.round(source.width * scale))
        const renderH = Math.max(1, Math.round(source.height * scale))

        const owned: Target[] = []
        const textures: WebGLTexture[] = []
        const sourceTex = uploadSource(source, renderW, renderH)
        textures.push(sourceTex)
        const baseLut = createCurveTexture(buildBaseCurveLut(256, state.baseCurve))
        const toneLut = createToneTexture(buildToneCurveLut(state.curves))
        textures.push(baseLut, toneLut)

        const lensPass = buildLensPass(state.lens, lensProfile)
        const passes = runPasses(sourceTex, source, renderW, renderH, state, baseLut, toneLut, lensPass)
        owned.push(...passes.targets)

        let finalTex = passes.finalTex
        let drawerCanvas: HTMLCanvasElement | null
        if (typeof drawer === 'function') {
            const photo = readTexturePhoto(passes.finalTex, renderW, renderH)
            drawerCanvas = photo ? drawer(photo) : null
        } else {
            drawerCanvas = drawer ?? null
        }
        if (drawerCanvas) {
            const drawerTexture = gl.createTexture()
            if (drawerTexture) {
                textures.push(drawerTexture)
                gl.bindTexture(gl.TEXTURE_2D, drawerTexture)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, drawerCanvas)
                const composited = createTarget(renderW, renderH)
                owned.push(composited)
                gl.bindFramebuffer(gl.FRAMEBUFFER, composited.fbo)
                gl.viewport(0, 0, renderW, renderH)
                gl.disable(gl.BLEND)
                gl.bindVertexArray(vao)
                gl.useProgram(drawerPass.program)
                gl.activeTexture(gl.TEXTURE0)
                gl.bindTexture(gl.TEXTURE_2D, passes.finalTex)
                gl.uniform1i(drawerPass.u.uTex, 0)
                gl.activeTexture(gl.TEXTURE1)
                gl.bindTexture(gl.TEXTURE_2D, drawerTexture)
                gl.uniform1i(drawerPass.u.uDrawerTex, 1)
                gl.uniformMatrix3fv(drawerPass.u.uSrgbToRec2020, false, toColumnMajor(SRGB_TO_REC2020))
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
                finalTex = composited.tex
            }
        }

        const exportFlip = composeFlip(source.flip, state.geometry.rotate90)
        const scanDims = scanOutputDims(renderW, renderH, state.scan)
        const dims = dispDims(scanDims.w, scanDims.h, exportFlip)
        const orientedW = dims.dispW
        const orientedH = dims.dispH
        const oriented = createTarget(orientedW, orientedH)
        owned.push(oriented)
        gl.bindFramebuffer(gl.FRAMEBUFFER, oriented.fbo)
        gl.viewport(0, 0, orientedW, orientedH)
        gl.disable(gl.BLEND)
        gl.bindVertexArray(vao)
        gl.useProgram(orient.program)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, finalTex)
        gl.uniform1i(orient.u.uTex, 0)
        gl.uniformMatrix3fv(orient.u.uModel, false, orientModelMatrix(orientedW, orientedH, exportFlip))
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            for (const target of owned) {
                gl.deleteTexture(target.tex)
                gl.deleteFramebuffer(target.fbo)
            }
            for (const texture of textures) gl.deleteTexture(texture)
            throw new Error(`export framebuffer incomplete: ${status}`)
        }

        const release = () => {
            for (const target of owned) {
                gl.deleteTexture(target.tex)
                gl.deleteFramebuffer(target.fbo)
            }
            for (const texture of textures) gl.deleteTexture(texture)
            owned.length = 0
            textures.length = 0
        }

        const stream = async (onTile: (tile: ExportTileData) => Promise<void>, shouldCancel: () => boolean) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, oriented.fbo)
            let processed = 0
            for (let iy = 0; iy < orientedH; iy += READBACK_TILE) {
                const th = Math.min(READBACK_TILE, orientedH - iy)
                for (let ix = 0; ix < orientedW; ix += READBACK_TILE) {
                    if (shouldCancel()) return false
                    const tw = Math.min(READBACK_TILE, orientedW - ix)
                    const fboY = orientedH - iy - th
                    let raw: Uint16Array
                    if (readType === gl.HALF_FLOAT) {
                        raw = new Uint16Array(tw * th * 4)
                        gl.readPixels(ix, fboY, tw, th, gl.RGBA, gl.HALF_FLOAT, raw)
                    } else {
                        const floats = new Float32Array(tw * th * 4)
                        gl.readPixels(ix, fboY, tw, th, gl.RGBA, gl.FLOAT, floats)
                        raw = new Uint16Array(floats.length)
                        for (let i = 0; i < floats.length; i++) raw[i] = floatToHalf(floats[i])
                    }
                    await onTile({ x: ix, y: iy, width: tw, height: th, data: flipRows(raw, tw, th) })
                    processed++
                    if (processed % RAF_TILE_INTERVAL === 0) await raf()
                }
            }
            return true
        }

        return { width: orientedW, height: orientedH, downscaled: scale < 1, stream, release }
    }

    const dispose = () => {
        for (const info of [pass1, pass2, pass3, pass4, pass5, nr, sharpen, pass7, tile, orient, drawerPass]) gl.deleteProgram(info.program)
        gl.deleteBuffer(quadBuffer)
        gl.deleteVertexArray(vao)
        const lose = gl.getExtension('WEBGL_lose_context')
        if (lose) lose.loseContext()
    }

    return { prepare, dispose }
}
