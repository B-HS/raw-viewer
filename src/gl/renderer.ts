import { buildBaseCurveLut } from './baseCurveLut'
import { IDENTITY3, REC2020_TO_P3, REC2020_TO_SRGB, SRGB_TO_P3, toColumnMajor } from './colorSpaces'
import {
    earliestDirtyStage,
    STAGE_COLOR,
    STAGE_COUNT,
    STAGE_CURVE,
    STAGE_DETAIL,
    STAGE_GEOMETRY,
    STAGE_NONE,
    STAGE_TONE,
    STAGE_WB,
    stageActive,
} from './dirty'
import { buildGeometryWarp } from './geometry'
import { applyLensUniforms, buildLensPass, PASS2_UNIFORMS } from './lensUniforms'
import { createHistogramService } from './histogram'
import { createGlContext, createProgram, uniformLocations } from './glContext'
import { effectsUniforms, hslUniforms, nrUniforms, sharpenUniforms, toneUniforms } from './passUniforms'
import { NEUTRAL_EDIT_STATE } from './stateDefaults'
import {
    FRAG_HISTO,
    FRAG_NR,
    FRAG_PASS1,
    FRAG_PASS2,
    FRAG_PASS3,
    FRAG_PASS4,
    FRAG_PASS5,
    FRAG_PASS7,
    FRAG_PASS8,
    FRAG_SHARPEN,
    FRAG_TILE,
    VERT_FULLSCREEN,
    VERT_QUAD,
    VERT_TILE,
} from './shaders'
import { buildToneCurveLut, TONE_LUT_SIZE } from './toneCurveLut'
import { effectiveMaxTexture, extractTile, needsTiling, planTiles, TILE_OVERLAP, TILE_SIZE } from './tiles'
import { buildModelMatrix, computeFitScale, dispDims, viewScale } from './viewTransform'
import { wbGainsFromState } from './wbModel'
import type { ClippingMode, CompareSplit } from './engineApi'
import type { LensPass } from './lensUniforms'
import type { ViewState } from './viewTransform'
import type { EditState } from '../types/EditState'
import type { LensProfileMatch } from '../types/LensProfileMatch'

type GpuImage = {
    imageId: string
    kind: 'l0' | 'aeth'
    width: number
    height: number
    flip: number
    colorMatrixCol: Float32Array | null
    source: WebGLTexture
}

type ProgramInfo = { program: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }

type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer }

type LevelUpload = { imageId: string; width: number; height: number; flip: number }

const BG = 60 / 255
const QUAD = new Float32Array([-1, 1, 0, 0, 1, 1, 1, 0, -1, -1, 0, 1, 1, -1, 1, 1])
const PROC_MAX = 4096
const CLIP_MODE: Record<ClippingMode, number> = { none: 0, both: 1, highlight: 2, shadow: 3 }

export class Renderer {
    private canvas: HTMLCanvasElement
    private gl: WebGL2RenderingContext
    readonly lowPrecision: boolean
    readonly displaySpace: 'display-p3' | 'srgb'
    private maxTextureSize: number
    private rec2020ToDisplay: Float32Array
    private srgbToDisplay: Float32Array
    private identityCol = toColumnMajor(IDENTITY3)

    private pass1!: ProgramInfo
    private pass2!: ProgramInfo
    private pass3!: ProgramInfo
    private pass4!: ProgramInfo
    private pass5!: ProgramInfo
    private nr!: ProgramInfo
    private sharpen!: ProgramInfo
    private pass7!: ProgramInfo
    private pass8!: ProgramInfo
    private tile!: ProgramInfo
    private histo!: ProgramInfo
    private vao!: WebGLVertexArrayObject
    private quadBuffer!: WebGLBuffer

    private baseLut!: WebGLTexture
    private baseLutStandard!: WebGLTexture
    private toneLut!: WebGLTexture
    private toneLutIdentity!: WebGLTexture

    private images = new Map<string, GpuImage>()
    private current: string | null = null

    private editState: EditState = NEUTRAL_EDIT_STATE
    private lensProfile: LensProfileMatch | null = null
    private lensProfileImageId: string | null = null
    private lensPass: LensPass | null = null
    private lensSig = ''
    private rebuildFrom = 0
    private clipMode: ClippingMode = 'none'
    private compareSplit: CompareSplit = null
    private sideBySide = false
    private cropEditMode = false

    private stages = new Map<number, Target>()
    private scratch: Target[] = []
    private base: Target | null = null
    private histoTarget: Target | null = null
    private histoW = 0
    private histoH = 0

    private procW = 0
    private procH = 0
    private procFrac = 0
    private processed: WebGLTexture | null = null
    private processedFbo: WebGLFramebuffer | null = null
    private processedFor: string | null = null
    private baseFor: string | null = null

    private lastModel = new Float32Array(9)
    private lastMetrics: { cw: number; ch: number } = { cw: 0, ch: 0 }

    private histogram = createHistogramService()

    constructor(canvas: HTMLCanvasElement) {
        const context = createGlContext(canvas)
        if (!context) throw new Error('webgl2 unavailable')
        this.canvas = canvas
        this.gl = context.gl
        this.lowPrecision = context.lowPrecision
        this.displaySpace = context.displaySpace
        this.maxTextureSize = context.maxTextureSize
        this.rec2020ToDisplay = toColumnMajor(context.displaySpace === 'display-p3' ? REC2020_TO_P3 : REC2020_TO_SRGB)
        this.srgbToDisplay = toColumnMajor(SRGB_TO_P3)
        this.buildResources()
    }

    private compile(vertex: string, fragment: string, names: string[]) {
        const program = createProgram(this.gl, vertex, fragment)
        return { program, u: uniformLocations(this.gl, program, names) }
    }

    private buildResources() {
        const gl = this.gl
        this.pass1 = this.compile(VERT_FULLSCREEN, FRAG_PASS1, ['uTex', 'uColorMatrix', 'uWbGain'])
        this.pass2 = this.compile(VERT_FULLSCREEN, FRAG_PASS2, PASS2_UNIFORMS)
        this.pass3 = this.compile(VERT_FULLSCREEN, FRAG_PASS3, [
            'uTex',
            'uExposure',
            'uHighlightRecovery',
            'uHighlights',
            'uShadows',
            'uWhites',
            'uBlacks',
            'uContrastK',
        ])
        this.pass4 = this.compile(VERT_FULLSCREEN, FRAG_PASS4, ['uTex', 'uBase', 'uTone'])
        this.pass5 = this.compile(VERT_FULLSCREEN, FRAG_PASS5, ['uTex', 'uHue', 'uSat', 'uLum', 'uVibrance', 'uSaturation', 'uBw'])
        this.nr = this.compile(VERT_FULLSCREEN, FRAG_NR, [
            'uTex',
            'uTexel',
            'uNrLuma',
            'uNrLumaDetail',
            'uNrLumaContrast',
            'uNrColor',
            'uNrColorDetail',
        ])
        this.sharpen = this.compile(VERT_FULLSCREEN, FRAG_SHARPEN, ['uTex', 'uTexel', 'uAmount', 'uRadius', 'uDetail', 'uMasking'])
        this.pass7 = this.compile(VERT_FULLSCREEN, FRAG_PASS7, [
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
        this.pass8 = this.compile(VERT_QUAD, FRAG_PASS8, [
            'uTex',
            'uBaseTex',
            'uModel',
            'uSourceKind',
            'uDisplayP3',
            'uRec2020ToDisplay',
            'uSrgbToDisplay',
            'uClipMode',
            'uHasBase',
            'uSplit',
            'uCropMode',
            'uCrop',
            'uCanvas',
        ])
        this.tile = this.compile(VERT_TILE, FRAG_TILE, ['uModel', 'uTile', 'uSrcOrigin', 'uUvOffset', 'uUvScale'])
        this.histo = this.compile(VERT_FULLSCREEN, FRAG_HISTO, ['uTex', 'uRec2020ToDisplay'])

        const buffer = gl.createBuffer()
        const vao = gl.createVertexArray()
        if (!buffer || !vao) throw new Error('gl buffer alloc failed')
        this.quadBuffer = buffer
        this.vao = vao
        gl.bindVertexArray(vao)
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW)
        gl.enableVertexAttribArray(0)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
        gl.enableVertexAttribArray(1)
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)
        gl.bindVertexArray(null)

        this.baseLut = this.createCurveTexture(buildBaseCurveLut(256, 'standard'))
        this.baseLutStandard = this.createCurveTexture(buildBaseCurveLut(256, 'standard'))
        this.toneLut = this.createToneTexture(buildToneCurveLut(NEUTRAL_EDIT_STATE.curves))
        this.toneLutIdentity = this.createToneTexture(buildToneCurveLut(NEUTRAL_EDIT_STATE.curves))
    }

    private createCurveTexture(data: Uint8Array) {
        const gl = this.gl
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

    private createToneTexture(data: Uint16Array) {
        const gl = this.gl
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

    resize() {
        const dpr = window.devicePixelRatio || 1
        const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
        const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
        if (this.canvas.width !== width) this.canvas.width = width
        if (this.canvas.height !== height) this.canvas.height = height
    }

    getMetrics() {
        if (!this.current) return null
        const image = this.images.get(this.current)
        if (!image) return null
        const { dispW, dispH } = dispDims(image.width, image.height, image.flip)
        const cw = this.canvas.width
        const ch = this.canvas.height
        return { cw, ch, dispW, dispH, dpr: window.devicePixelRatio || 1, fitScale: computeFitScale(cw, ch, dispW, dispH) }
    }

    hasImage(imageId: string) {
        return this.images.has(imageId)
    }

    setCurrent(imageId: string | null) {
        if (this.current === imageId) return
        this.current = imageId
        this.processedFor = null
        this.baseFor = null
        this.refreshLens()
    }

    setWindow(windowIds: string[]) {
        const keep = new Set(windowIds)
        if (this.current) keep.add(this.current)
        for (const [imageId, image] of this.images) {
            if (keep.has(imageId)) continue
            this.gl.deleteTexture(image.source)
            this.images.delete(imageId)
        }
    }

    setEditState(state: EditState | null) {
        const next = state ?? NEUTRAL_EDIT_STATE
        const stage = earliestDirtyStage(this.editState, next)
        if (stage < this.rebuildFrom) this.rebuildFrom = stage
        if (next.baseCurve !== this.editState.baseCurve) {
            this.gl.deleteTexture(this.baseLut)
            this.baseLut = this.createCurveTexture(buildBaseCurveLut(256, next.baseCurve))
        }
        if (next.curves !== this.editState.curves) {
            this.gl.deleteTexture(this.toneLut)
            this.toneLut = this.createToneTexture(buildToneCurveLut(next.curves))
        }
        this.editState = next
        this.refreshLens()
    }

    setLensProfile(imageId: string | null, profile: LensProfileMatch | null) {
        this.lensProfileImageId = imageId
        this.lensProfile = profile
        this.refreshLens()
    }

    private refreshLens() {
        const profile = this.lensProfileImageId === this.current ? this.lensProfile : null
        const next = buildLensPass(this.editState.lens, profile)
        const sig = next ? JSON.stringify(next) : ''
        if (sig === this.lensSig) return
        this.lensPass = next
        this.lensSig = sig
        if (STAGE_GEOMETRY < this.rebuildFrom) this.rebuildFrom = STAGE_GEOMETRY
    }

    setClipping(mode: ClippingMode) {
        this.clipMode = mode
    }

    setCompare(split: CompareSplit) {
        this.compareSplit = split
    }

    setSideBySide(on: boolean) {
        this.sideBySide = on
    }

    setCropEditMode(on: boolean) {
        this.cropEditMode = on
    }

    onHistogram = this.histogram.onHistogram

    private buildTiledProxy(data: Uint16Array, width: number, height: number) {
        const gl = this.gl
        const cap = Math.min(effectiveMaxTexture(this.maxTextureSize), PROC_MAX)
        const scale = Math.min(1, cap / Math.max(width, height))
        const pw = Math.max(1, Math.round(width * scale))
        const ph = Math.max(1, Math.round(height * scale))
        const proxy = this.createColorTarget(pw, ph)
        const tileSize = Math.min(TILE_SIZE, effectiveMaxTexture(this.maxTextureSize))
        const tiles = planTiles(width, height, tileSize, TILE_OVERLAP)
        gl.bindFramebuffer(gl.FRAMEBUFFER, proxy.fbo)
        gl.viewport(0, 0, pw, ph)
        gl.disable(gl.BLEND)
        gl.bindVertexArray(this.vao)
        gl.useProgram(this.tile.program)
        gl.activeTexture(gl.TEXTURE0)
        for (const t of tiles) {
            const sub = extractTile(data, width, t)
            const texture = gl.createTexture()
            if (!texture) continue
            gl.bindTexture(gl.TEXTURE_2D, texture)
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, t.texW, t.texH, 0, gl.RGB, gl.HALF_FLOAT, sub)
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            const sx = t.coreW / width
            const sy = t.coreH / height
            const tx = (2 * t.sx0 + t.coreW) / width - 1
            const ty = (2 * t.sy0 + t.coreH) / height - 1
            gl.uniformMatrix3fv(this.tile.u.uModel, false, new Float32Array([sx, 0, 0, 0, sy, 0, tx, ty, 1]))
            gl.uniform1i(this.tile.u.uTile, 0)
            gl.uniform2f(this.tile.u.uSrcOrigin, t.sx0 / width, t.sy0 / height)
            gl.uniform2f(this.tile.u.uUvOffset, t.overlapL / t.texW, t.overlapT / t.texH)
            gl.uniform2f(this.tile.u.uUvScale, width / t.texW, height / t.texH)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
            gl.deleteTexture(texture)
        }
        gl.deleteFramebuffer(proxy.fbo)
        return proxy.tex
    }

    uploadAeth(upload: LevelUpload & { colorMatrix: number[] | null }, data: Uint16Array) {
        const gl = this.gl
        const tiled = needsTiling(upload.width, upload.height, this.maxTextureSize)
        if (tiled && this.lowPrecision) return false
        const previous = this.images.get(upload.imageId)
        let source: WebGLTexture | null
        if (tiled) {
            source = this.buildTiledProxy(data, upload.width, upload.height)
        } else {
            source = gl.createTexture()
            if (!source) return false
            gl.bindTexture(gl.TEXTURE_2D, source)
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, upload.width, upload.height, 0, gl.RGB, gl.HALF_FLOAT, data)
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
            this.applyDefaultFilter()
        }
        if (!source) return false
        if (previous) gl.deleteTexture(previous.source)
        this.images.set(upload.imageId, {
            imageId: upload.imageId,
            kind: 'aeth',
            width: upload.width,
            height: upload.height,
            flip: upload.flip,
            colorMatrixCol: upload.colorMatrix ? toColumnMajor(upload.colorMatrix) : null,
            source,
        })
        if (upload.imageId === this.current) {
            this.processedFor = null
            this.baseFor = null
        }
        return true
    }

    uploadL0(upload: LevelUpload, bitmap: ImageBitmap) {
        if (upload.width > this.maxTextureSize || upload.height > this.maxTextureSize) return false
        const gl = this.gl
        const previous = this.images.get(upload.imageId)
        const texture = gl.createTexture()
        if (!texture) return false
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
        this.applyDefaultFilter()
        if (previous) gl.deleteTexture(previous.source)
        this.images.set(upload.imageId, {
            imageId: upload.imageId,
            kind: 'l0',
            width: upload.width,
            height: upload.height,
            flip: upload.flip,
            colorMatrixCol: null,
            source: texture,
        })
        if (upload.imageId === this.current) {
            this.processedFor = null
            this.baseFor = null
        }
        return true
    }

    private applyDefaultFilter() {
        const gl = this.gl
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    }

    private createColorTarget(width: number, height: number): Target {
        const gl = this.gl
        const texture = gl.createTexture()
        if (!texture) throw new Error('gl target texture alloc failed')
        gl.bindTexture(gl.TEXTURE_2D, texture)
        const internal = this.lowPrecision ? gl.RGBA8 : gl.RGBA16F
        const type = this.lowPrecision ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        const framebuffer = gl.createFramebuffer()
        if (!framebuffer) throw new Error('gl target fbo alloc failed')
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
        return { tex: texture, fbo: framebuffer }
    }

    private createHisto(width: number, height: number): Target {
        const gl = this.gl
        const texture = gl.createTexture()
        if (!texture) throw new Error('gl histo texture alloc failed')
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        const framebuffer = gl.createFramebuffer()
        if (!framebuffer) throw new Error('gl histo fbo alloc failed')
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
        return { tex: texture, fbo: framebuffer }
    }

    private freeProcBuffers() {
        const gl = this.gl
        for (const target of this.stages.values()) {
            gl.deleteTexture(target.tex)
            gl.deleteFramebuffer(target.fbo)
        }
        this.stages.clear()
        for (const target of this.scratch) {
            gl.deleteTexture(target.tex)
            gl.deleteFramebuffer(target.fbo)
        }
        this.scratch = []
        if (this.base) {
            gl.deleteTexture(this.base.tex)
            gl.deleteFramebuffer(this.base.fbo)
            this.base = null
        }
        if (this.histoTarget) {
            gl.deleteTexture(this.histoTarget.tex)
            gl.deleteFramebuffer(this.histoTarget.fbo)
            this.histoTarget = null
        }
        this.baseFor = null
    }

    private stageTarget(id: number) {
        let target = this.stages.get(id)
        if (!target) {
            target = this.createColorTarget(this.procW, this.procH)
            this.stages.set(id, target)
        }
        return target
    }

    private scratchTarget(index: number) {
        while (this.scratch.length <= index) this.scratch.push(this.createColorTarget(this.procW, this.procH))
        return this.scratch[index]
    }

    private computeProcDims(
        view: ViewState,
        metrics: { dpr: number; fitScale: number; dispW: number; dispH: number; cw: number; ch: number },
        image: GpuImage,
    ) {
        const frac = Math.min(1, Math.max(0.03, viewScale(view, metrics)))
        const cap = Math.min(this.maxTextureSize, PROC_MAX)
        let w = Math.max(1, Math.round(image.width * frac))
        let h = Math.max(1, Math.round(image.height * frac))
        const big = Math.max(w, h)
        if (big > cap) {
            const k = cap / big
            w = Math.max(1, Math.round(w * k))
            h = Math.max(1, Math.round(h * k))
        }
        return { w, h, frac: w / image.width }
    }

    private drawFullscreen() {
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4)
    }

    private runStage(id: number, input: WebGLTexture, image: GpuImage) {
        const gl = this.gl
        const texel = new Float32Array([1 / this.procW, 1 / this.procH])
        if (id === STAGE_WB) {
            const target = this.stageTarget(id)
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
            gl.viewport(0, 0, this.procW, this.procH)
            gl.useProgram(this.pass1.program)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, input)
            gl.uniform1i(this.pass1.u.uTex, 0)
            gl.uniformMatrix3fv(this.pass1.u.uColorMatrix, false, image.colorMatrixCol ?? this.identityCol)
            gl.uniform3fv(this.pass1.u.uWbGain, wbGainsFromState(this.editState.wb))
            this.drawFullscreen()
            return target.tex
        }
        if (id === STAGE_GEOMETRY) {
            const target = this.stageTarget(id)
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
            gl.viewport(0, 0, this.procW, this.procH)
            gl.useProgram(this.pass2.program)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, input)
            gl.uniform1i(this.pass2.u.uTex, 0)
            gl.uniformMatrix3fv(this.pass2.u.uWarp, false, buildGeometryWarp(this.editState.geometry))
            applyLensUniforms(gl, this.pass2, this.lensPass, this.procW, this.procH)
            this.drawFullscreen()
            return target.tex
        }
        if (id === STAGE_TONE) {
            const target = this.stageTarget(id)
            const t = toneUniforms(this.editState.tone)
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
            gl.viewport(0, 0, this.procW, this.procH)
            gl.useProgram(this.pass3.program)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, input)
            gl.uniform1i(this.pass3.u.uTex, 0)
            gl.uniform1f(this.pass3.u.uExposure, t.exposure)
            gl.uniform1f(this.pass3.u.uHighlightRecovery, t.highlightRecovery)
            gl.uniform1f(this.pass3.u.uHighlights, t.highlights)
            gl.uniform1f(this.pass3.u.uShadows, t.shadows)
            gl.uniform1f(this.pass3.u.uWhites, t.whites)
            gl.uniform1f(this.pass3.u.uBlacks, t.blacks)
            gl.uniform1f(this.pass3.u.uContrastK, t.contrastK)
            this.drawFullscreen()
            return target.tex
        }
        if (id === STAGE_CURVE) {
            const target = this.stageTarget(id)
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
            gl.viewport(0, 0, this.procW, this.procH)
            gl.useProgram(this.pass4.program)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, input)
            gl.uniform1i(this.pass4.u.uTex, 0)
            gl.activeTexture(gl.TEXTURE1)
            gl.bindTexture(gl.TEXTURE_2D, this.baseLut)
            gl.uniform1i(this.pass4.u.uBase, 1)
            gl.activeTexture(gl.TEXTURE2)
            gl.bindTexture(gl.TEXTURE_2D, this.toneLut)
            gl.uniform1i(this.pass4.u.uTone, 2)
            this.drawFullscreen()
            return target.tex
        }
        if (id === STAGE_COLOR) {
            const target = this.stageTarget(id)
            const h = hslUniforms(this.editState.color)
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
            gl.viewport(0, 0, this.procW, this.procH)
            gl.useProgram(this.pass5.program)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, input)
            gl.uniform1i(this.pass5.u.uTex, 0)
            gl.uniform1fv(this.pass5.u.uHue, h.hue)
            gl.uniform1fv(this.pass5.u.uSat, h.sat)
            gl.uniform1fv(this.pass5.u.uLum, h.lum)
            gl.uniform1f(this.pass5.u.uVibrance, h.vibrance)
            gl.uniform1f(this.pass5.u.uSaturation, h.saturation)
            gl.uniform1i(this.pass5.u.uBw, h.bw)
            this.drawFullscreen()
            return target.tex
        }
        if (id === STAGE_DETAIL) {
            const target = this.stageTarget(id)
            const detail = this.editState.detail
            const nrActive = detail.nrLuminance > 0 || detail.nrColor > 0
            const sharpenActive = detail.sharpenAmount > 0
            let stageInput = input
            if (nrActive) {
                const dst = sharpenActive ? this.scratchTarget(0) : target
                const n = nrUniforms(detail)
                gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
                gl.viewport(0, 0, this.procW, this.procH)
                gl.useProgram(this.nr.program)
                gl.activeTexture(gl.TEXTURE0)
                gl.bindTexture(gl.TEXTURE_2D, stageInput)
                gl.uniform1i(this.nr.u.uTex, 0)
                gl.uniform2fv(this.nr.u.uTexel, texel)
                gl.uniform1f(this.nr.u.uNrLuma, n.nrLuma)
                gl.uniform1f(this.nr.u.uNrLumaDetail, n.nrLumaDetail)
                gl.uniform1f(this.nr.u.uNrLumaContrast, n.nrLumaContrast)
                gl.uniform1f(this.nr.u.uNrColor, n.nrColor)
                gl.uniform1f(this.nr.u.uNrColorDetail, n.nrColorDetail)
                this.drawFullscreen()
                stageInput = dst.tex
            }
            if (sharpenActive) {
                const s = sharpenUniforms(detail)
                gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
                gl.viewport(0, 0, this.procW, this.procH)
                gl.useProgram(this.sharpen.program)
                gl.activeTexture(gl.TEXTURE0)
                gl.bindTexture(gl.TEXTURE_2D, stageInput)
                gl.uniform1i(this.sharpen.u.uTex, 0)
                gl.uniform2fv(this.sharpen.u.uTexel, texel)
                gl.uniform1f(this.sharpen.u.uAmount, s.amount)
                gl.uniform1f(this.sharpen.u.uRadius, s.radius)
                gl.uniform1f(this.sharpen.u.uDetail, s.detail)
                gl.uniform1f(this.sharpen.u.uMasking, s.masking)
                this.drawFullscreen()
            }
            return target.tex
        }
        const target = this.stageTarget(id)
        const e = effectsUniforms(this.editState.effects)
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
        gl.viewport(0, 0, this.procW, this.procH)
        gl.useProgram(this.pass7.program)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, input)
        gl.uniform1i(this.pass7.u.uTex, 0)
        gl.uniform2fv(this.pass7.u.uTexel, texel)
        gl.uniform1f(this.pass7.u.uClarity, e.clarity)
        gl.uniform1f(this.pass7.u.uDehaze, e.dehaze)
        gl.uniform1f(this.pass7.u.uVignetteAmount, e.vignetteAmount)
        gl.uniform1f(this.pass7.u.uVignetteMidpoint, e.vignetteMidpoint)
        gl.uniform1f(this.pass7.u.uVignetteRoundness, e.vignetteRoundness)
        gl.uniform1f(this.pass7.u.uVignetteFeather, e.vignetteFeather)
        gl.uniform1f(this.pass7.u.uGrainAmount, e.grainAmount)
        gl.uniform1f(this.pass7.u.uGrainSize, e.grainSize)
        gl.uniform1f(this.pass7.u.uGrainRoughness, e.grainRoughness)
        gl.uniform1f(this.pass7.u.uSeed, 1.0)
        this.drawFullscreen()
        return target.tex
    }

    private activeStages() {
        const list: number[] = []
        for (let stage = 0; stage < STAGE_COUNT; stage++) {
            const active =
                stage === STAGE_GEOMETRY ? stageActive(stage, this.editState) || this.lensPass !== null : stageActive(stage, this.editState)
            if (active) list.push(stage)
        }
        return list
    }

    private runChain(image: GpuImage, from: number) {
        const gl = this.gl
        gl.disable(gl.BLEND)
        gl.bindVertexArray(this.vao)
        const active = this.activeStages()
        let input = image.source
        let last: WebGLTexture = image.source
        let lastFbo: WebGLFramebuffer | null = null
        for (const id of active) {
            if (id < from) {
                const cached = this.stages.get(id)
                if (cached) {
                    input = cached.tex
                    last = cached.tex
                    lastFbo = cached.fbo
                }
                continue
            }
            last = this.runStage(id, input, image)
            input = last
            lastFbo = this.stages.get(id)?.fbo ?? null
        }
        this.processed = last
        this.processedFbo = lastFbo
    }

    private buildBase(image: GpuImage) {
        const gl = this.gl
        if (!this.base) this.base = this.createColorTarget(this.procW, this.procH)
        const inter = this.scratchTarget(1)
        gl.disable(gl.BLEND)
        gl.bindVertexArray(this.vao)
        gl.bindFramebuffer(gl.FRAMEBUFFER, inter.fbo)
        gl.viewport(0, 0, this.procW, this.procH)
        gl.useProgram(this.pass1.program)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, image.source)
        gl.uniform1i(this.pass1.u.uTex, 0)
        gl.uniformMatrix3fv(this.pass1.u.uColorMatrix, false, image.colorMatrixCol ?? this.identityCol)
        gl.uniform3fv(this.pass1.u.uWbGain, wbGainsFromState(NEUTRAL_EDIT_STATE.wb))
        this.drawFullscreen()

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.base.fbo)
        gl.viewport(0, 0, this.procW, this.procH)
        gl.useProgram(this.pass4.program)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, inter.tex)
        gl.uniform1i(this.pass4.u.uTex, 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, this.baseLutStandard)
        gl.uniform1i(this.pass4.u.uBase, 1)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, this.toneLutIdentity)
        gl.uniform1i(this.pass4.u.uTone, 2)
        this.drawFullscreen()
        this.baseFor = image.imageId
    }

    private sampleHistogram() {
        if (!this.histogram.hasSubscribers() || !this.processed) return
        this.histogram.maybeSample(() => {
            const gl = this.gl
            const hw = Math.max(1, Math.floor(this.procW / 8))
            const hh = Math.max(1, Math.floor(this.procH / 8))
            if (!this.histoTarget || this.histoW !== hw || this.histoH !== hh) {
                if (this.histoTarget) {
                    gl.deleteTexture(this.histoTarget.tex)
                    gl.deleteFramebuffer(this.histoTarget.fbo)
                }
                this.histoTarget = this.createHisto(hw, hh)
                this.histoW = hw
                this.histoH = hh
            }
            gl.disable(gl.BLEND)
            gl.bindVertexArray(this.vao)
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.histoTarget.fbo)
            gl.viewport(0, 0, hw, hh)
            gl.useProgram(this.histo.program)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, this.processed as WebGLTexture)
            gl.uniform1i(this.histo.u.uTex, 0)
            gl.uniformMatrix3fv(this.histo.u.uRec2020ToDisplay, false, this.rec2020ToDisplay)
            this.drawFullscreen()
            const pixels = new Uint8Array(hw * hh * 4)
            gl.readPixels(0, 0, hw, hh, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
            return pixels
        })
    }

    render(view: ViewState) {
        const gl = this.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, this.canvas.width, this.canvas.height)
        gl.clearColor(BG, BG, BG, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)

        if (!this.current) return
        const image = this.images.get(this.current)
        if (!image) return
        const metrics = this.getMetrics()
        if (!metrics) return

        let compareBase: WebGLTexture | null = null
        if (image.kind === 'l0') {
            this.processed = image.source
            this.processedFbo = null
            this.processedFor = image.imageId
        } else {
            const target = this.computeProcDims(view, metrics, image)
            if (this.processedFor !== image.imageId || this.stages.size === 0) {
                this.setProc(target.w, target.h, target.frac)
                this.rebuildFrom = 0
            } else if (target.frac > this.procFrac * 1.25) {
                this.setProc(target.w, target.h, target.frac)
                this.rebuildFrom = 0
            }
            if (this.rebuildFrom < STAGE_COUNT) {
                this.runChain(image, this.rebuildFrom)
                this.rebuildFrom = STAGE_NONE
                this.processedFor = image.imageId
                this.baseFor = null
            }
            if (this.compareSplit || this.sideBySide) {
                if (this.baseFor !== image.imageId) this.buildBase(image)
                compareBase = this.base?.tex ?? null
            }
            this.sampleHistogram()
        }
        if (!this.processed) return
        if (this.sideBySide && image.kind !== 'l0' && compareBase) {
            this.drawSideBySide(image, this.processed, compareBase, metrics, view)
        } else {
            this.drawOutput(image, this.processed, compareBase, metrics, view)
        }
    }

    private setProc(w: number, h: number, frac: number) {
        if (this.procW === w && this.procH === h) {
            this.procFrac = frac
            return
        }
        this.freeProcBuffers()
        this.procW = w
        this.procH = h
        this.procFrac = frac
    }

    private drawOutput(
        image: GpuImage,
        tex: WebGLTexture,
        baseTex: WebGLTexture | null,
        metrics: ReturnType<Renderer['getMetrics']>,
        view: ViewState,
    ) {
        if (!metrics) return
        const gl = this.gl
        const model = buildModelMatrix(view, metrics, image.width, image.height, image.flip)
        this.lastModel = model
        this.lastMetrics = { cw: metrics.cw, ch: metrics.ch }
        const nearest = viewScale(view, metrics) > metrics.dpr + 0.001
        const filter = nearest ? gl.NEAREST : gl.LINEAR
        const crop = this.editState.crop
        const cropMode = crop && crop.enabled ? (this.cropEditMode ? 2 : 1) : 0
        const split = this.compareSplit
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, this.canvas.width, this.canvas.height)
        gl.useProgram(this.pass8.program)
        gl.bindVertexArray(this.vao)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
        gl.uniform1i(this.pass8.u.uTex, 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, baseTex ?? tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
        gl.uniform1i(this.pass8.u.uBaseTex, 1)
        gl.uniformMatrix3fv(this.pass8.u.uModel, false, model)
        gl.uniform1i(this.pass8.u.uSourceKind, image.kind === 'l0' ? 1 : 0)
        gl.uniform1i(this.pass8.u.uDisplayP3, this.displaySpace === 'display-p3' ? 1 : 0)
        gl.uniformMatrix3fv(this.pass8.u.uRec2020ToDisplay, false, this.rec2020ToDisplay)
        gl.uniformMatrix3fv(this.pass8.u.uSrgbToDisplay, false, this.srgbToDisplay)
        gl.uniform1i(this.pass8.u.uClipMode, CLIP_MODE[this.clipMode])
        gl.uniform1i(this.pass8.u.uHasBase, baseTex ? 1 : 0)
        gl.uniform3f(this.pass8.u.uSplit, split ? 1 : 0, split?.axis === 'y' ? 1 : 0, split?.position ?? 0)
        gl.uniform1i(this.pass8.u.uCropMode, cropMode)
        gl.uniform4f(this.pass8.u.uCrop, crop?.left ?? 0, crop?.top ?? 0, crop?.right ?? 1, crop?.bottom ?? 1)
        gl.uniform2f(this.pass8.u.uCanvas, this.canvas.width, this.canvas.height)
        this.drawFullscreen()
    }

    private drawSideBySide(
        image: GpuImage,
        procTex: WebGLTexture,
        baseTex: WebGLTexture,
        metrics: NonNullable<ReturnType<Renderer['getMetrics']>>,
        view: ViewState,
    ) {
        const gl = this.gl
        const cw = this.canvas.width
        const ch = this.canvas.height
        const halfW = Math.floor(cw / 2)
        const paneMetrics = { ...metrics, cw: halfW, fitScale: computeFitScale(halfW, ch, metrics.dispW, metrics.dispH) }
        const model = buildModelMatrix(view, paneMetrics, image.width, image.height, image.flip)
        this.lastModel = model
        this.lastMetrics = { cw: halfW, ch }
        const nearest = viewScale(view, paneMetrics) > paneMetrics.dpr + 0.001
        const filter = nearest ? gl.NEAREST : gl.LINEAR
        const crop = this.editState.crop
        const cropMode = crop && crop.enabled ? (this.cropEditMode ? 2 : 1) : 0
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.useProgram(this.pass8.program)
        gl.bindVertexArray(this.vao)
        gl.uniformMatrix3fv(this.pass8.u.uModel, false, model)
        gl.uniform1i(this.pass8.u.uSourceKind, 0)
        gl.uniform1i(this.pass8.u.uDisplayP3, this.displaySpace === 'display-p3' ? 1 : 0)
        gl.uniformMatrix3fv(this.pass8.u.uRec2020ToDisplay, false, this.rec2020ToDisplay)
        gl.uniformMatrix3fv(this.pass8.u.uSrgbToDisplay, false, this.srgbToDisplay)
        gl.uniform1i(this.pass8.u.uClipMode, CLIP_MODE[this.clipMode])
        gl.uniform1i(this.pass8.u.uHasBase, 0)
        gl.uniform3f(this.pass8.u.uSplit, 0, 0, 0)
        gl.uniform1i(this.pass8.u.uCropMode, cropMode)
        gl.uniform4f(this.pass8.u.uCrop, crop?.left ?? 0, crop?.top ?? 0, crop?.right ?? 1, crop?.bottom ?? 1)
        gl.uniform2f(this.pass8.u.uCanvas, cw, ch)
        gl.uniform1i(this.pass8.u.uTex, 0)
        gl.uniform1i(this.pass8.u.uBaseTex, 0)
        this.drawComparePane(baseTex, filter, 0, halfW, ch)
        this.drawComparePane(procTex, filter, halfW, cw - halfW, ch)
    }

    private drawComparePane(tex: WebGLTexture, filter: number, vpX: number, vpW: number, ch: number) {
        const gl = this.gl
        gl.viewport(vpX, 0, vpW, ch)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
        this.drawFullscreen()
    }

    samplePixel(canvasX: number, canvasY: number) {
        if (!this.processed || !this.processedFbo || this.procW === 0) return null
        const gl = this.gl
        const scaleX = this.canvas.clientWidth > 0 ? this.canvas.width / this.canvas.clientWidth : 1
        const scaleY = this.canvas.clientHeight > 0 ? this.canvas.height / this.canvas.clientHeight : 1
        const ndcX = (2 * canvasX * scaleX) / this.lastMetrics.cw - 1
        const ndcY = 1 - (2 * canvasY * scaleY) / this.lastMetrics.ch
        const m = this.lastModel
        const a = m[0]
        const b = m[1]
        const c = m[3]
        const d = m[4]
        const det = a * d - b * c
        if (Math.abs(det) < 1e-9) return null
        const rx = ndcX - m[6]
        const ry = ndcY - m[7]
        const posX = (d * rx - c * ry) / det
        const posY = (-b * rx + a * ry) / det
        const uvX = posX * 0.5 + 0.5
        const uvY = (1 - posY) * 0.5
        if (uvX < 0 || uvX > 1 || uvY < 0 || uvY > 1) return null
        const px = Math.min(this.procW - 1, Math.max(0, Math.round(uvX * this.procW)))
        const py = Math.min(this.procH - 1, Math.max(0, Math.round(uvY * this.procH)))
        const x0 = Math.max(0, px - 2)
        const y0 = Math.max(0, py - 2)
        const w = Math.min(5, this.procW - x0)
        const h = Math.min(5, this.procH - y0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.processedFbo)
        let r = 0
        let g = 0
        let bl = 0
        if (this.lowPrecision) {
            const buffer = new Uint8Array(w * h * 4)
            gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buffer)
            for (let i = 0; i < w * h; i++) {
                r += buffer[i * 4] / 255
                g += buffer[i * 4 + 1] / 255
                bl += buffer[i * 4 + 2] / 255
            }
        } else {
            const buffer = new Float32Array(w * h * 4)
            gl.readPixels(x0, y0, w, h, gl.RGBA, gl.FLOAT, buffer)
            for (let i = 0; i < w * h; i++) {
                r += buffer[i * 4]
                g += buffer[i * 4 + 1]
                bl += buffer[i * 4 + 2]
            }
        }
        const count = w * h
        return { r: r / count, g: g / count, b: bl / count }
    }

    reinit() {
        this.images.clear()
        this.current = null
        this.processed = null
        this.processedFbo = null
        this.processedFor = null
        this.baseFor = null
        this.stages.clear()
        this.scratch = []
        this.base = null
        this.histoTarget = null
        this.procW = 0
        this.procH = 0
        this.procFrac = 0
        this.rebuildFrom = 0
        this.buildResources()
    }

    dispose() {
        const gl = this.gl
        for (const image of this.images.values()) gl.deleteTexture(image.source)
        this.images.clear()
        this.freeProcBuffers()
        gl.deleteTexture(this.baseLut)
        gl.deleteTexture(this.baseLutStandard)
        gl.deleteTexture(this.toneLut)
        gl.deleteTexture(this.toneLutIdentity)
        gl.deleteBuffer(this.quadBuffer)
        gl.deleteVertexArray(this.vao)
        for (const info of [
            this.pass1,
            this.pass2,
            this.pass3,
            this.pass4,
            this.pass5,
            this.nr,
            this.sharpen,
            this.pass7,
            this.pass8,
            this.tile,
            this.histo,
        ]) {
            gl.deleteProgram(info.program)
        }
        this.histogram.dispose()
    }
}
