import { buildBaseCurveLut } from '../baseCurveLut'
import { IDENTITY3, REC2020_TO_P3, REC2020_TO_SRGB, SRGB_TO_P3, SRGB_TO_REC2020, toColumnMajor } from '../colorSpaces'
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
} from '../dirty'
import { buildGeometryWarp } from '../geometry'
import { floatToHalf, halfToFloat } from '../half'
import type { Histogram, HistogramCallback } from '../histogram'
import { buildLensPass, lensNormScale } from '../lensUniforms'
import type { LensPass } from '../lensUniforms'
import { effectsUniforms, hslUniforms, nrUniforms, sharpenUniforms, toneUniforms } from '../passUniforms'
import { NEUTRAL_EDIT_STATE } from '../stateDefaults'
import { buildToneCurveLut, TONE_LUT_SIZE } from '../toneCurveLut'
import { floatRgbaToSrgbBytes } from '../photoConvert'
import { scanCornerArray, scanEdgeArray, scanOutputDims } from '../scan'
import { buildModelMatrix, composeFlip, computeFitScale, dispDims, viewScale } from '../viewTransform'
import type { ViewState } from '../viewTransform'
import { wbGainsFromState } from '../wbModel'
import type { ClippingMode, CompareSplit } from '../viewTypes'
import {
    NR_COMPUTE_WORKGROUP,
    WGSL_HISTOGRAM,
    WGSL_NR_COMPUTE,
    WGSL_DRAWER,
    WGSL_ORIENT,
    WGSL_PASS1,
    WGSL_PASS2,
    WGSL_PASS3,
    WGSL_PASS4,
    WGSL_PASS5,
    WGSL_PASS7,
    WGSL_PASS8,
    WGSL_SHARPEN,
} from './wgsl'
import type { EditState } from '../../types/EditState'
import type { LensProfileMatch } from '../../types/LensProfileMatch'

type GpuImage = {
    imageId: string
    kind: 'l0' | 'aeth'
    width: number
    height: number
    flip: number
    colorMatrixCol: Float32Array | null
    source: GPUTexture
}

type LevelUpload = { imageId: string; width: number; height: number; flip: number }

export type ExportFrame = { width: number; height: number; data: Uint16Array }

const BG = 60 / 255
const QUAD = new Float32Array([-1, 1, 0, 0, 1, 1, 1, 0, -1, -1, 0, 1, 1, -1, 1, 1])
const PROC_MAX = 4096
const MIRROR_MAX = 1024
const HISTOGRAM_THROTTLE_MS = 150
const MIRROR_THROTTLE_MS = 120
const CLIP_MODE: Record<ClippingMode, number> = { none: 0, both: 1, highlight: 2, shadow: 3 }
const HALF_ONE = 0x3c00

const PROC_FORMAT: GPUTextureFormat = 'rgba16float'

const writeMat3 = (out: Float32Array, offset: number, columnMajor3: Float32Array) => {
    for (let col = 0; col < 3; col++) {
        out[offset + col * 4] = columnMajor3[col * 3]
        out[offset + col * 4 + 1] = columnMajor3[col * 3 + 1]
        out[offset + col * 4 + 2] = columnMajor3[col * 3 + 2]
    }
}

const UPLOAD_CHUNK_ROWS = 512

const writeRgbHalfAsRgba = (device: GPUDevice, texture: GPUTexture, data: Uint16Array, width: number, height: number) => {
    const chunk = new Uint16Array(width * Math.min(UPLOAD_CHUNK_ROWS, height) * 4)
    for (let row = 0; row < height; row += UPLOAD_CHUNK_ROWS) {
        const rows = Math.min(UPLOAD_CHUNK_ROWS, height - row)
        for (let i = 0; i < width * rows; i++) {
            const src = (row * width + i) * 3
            chunk[i * 4] = data[src]
            chunk[i * 4 + 1] = data[src + 1]
            chunk[i * 4 + 2] = data[src + 2]
            chunk[i * 4 + 3] = HALF_ONE
        }
        device.queue.writeTexture(
            { texture, origin: { x: 0, y: row } },
            chunk.subarray(0, width * rows * 4),
            { bytesPerRow: width * 8 },
            { width, height: rows },
        )
    }
}

const downscaleRgbHalf = (data: Uint16Array, width: number, height: number, targetW: number, targetH: number) => {
    const out = new Uint16Array(targetW * targetH * 3)
    for (let ty = 0; ty < targetH; ty++) {
        const sy0 = Math.floor((ty * height) / targetH)
        const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) * height) / targetH))
        for (let tx = 0; tx < targetW; tx++) {
            const sx0 = Math.floor((tx * width) / targetW)
            const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) * width) / targetW))
            let r = 0
            let g = 0
            let b = 0
            let count = 0
            for (let sy = sy0; sy < sy1; sy++) {
                for (let sx = sx0; sx < sx1; sx++) {
                    const index = (sy * width + sx) * 3
                    r += halfToFloat(data[index])
                    g += halfToFloat(data[index + 1])
                    b += halfToFloat(data[index + 2])
                    count++
                }
            }
            const outIndex = (ty * targetW + tx) * 3
            out[outIndex] = floatToHalf(r / count)
            out[outIndex + 1] = floatToHalf(g / count)
            out[outIndex + 2] = floatToHalf(b / count)
        }
    }
    return out
}

const alignBytesPerRow = (bytes: number) => Math.ceil(bytes / 256) * 256

export class WebGpuRenderer {
    readonly lowPrecision = false
    readonly displaySpace: 'display-p3' | 'srgb'

    private canvas: HTMLCanvasElement
    private device: GPUDevice
    private context: GPUCanvasContext
    private canvasFormat: GPUTextureFormat
    private maxTextureSize: number
    private rec2020ToDisplayCol: Float32Array
    private srgbToDisplayCol: Float32Array
    private identityCol = toColumnMajor(IDENTITY3)
    private srgbToRec2020Col = toColumnMajor(SRGB_TO_REC2020)
    private drawerTexture: GPUTexture | null = null
    private drawerPlaceholderTex: GPUTexture | null = null

    private fullscreenPipelines = new Map<string, GPURenderPipeline>()
    private pass8Pipeline!: GPURenderPipeline
    private histogramPipeline!: GPUComputePipeline
    private nrComputePipeline!: GPUComputePipeline
    private quadBuffer!: GPUBuffer
    private linearSampler!: GPUSampler
    private nearestSampler!: GPUSampler

    private baseLut!: GPUTexture
    private baseLutStandard!: GPUTexture
    private toneLut!: GPUTexture
    private toneLutIdentity!: GPUTexture
    private displayLut!: GPUTexture
    private lutSize = 0
    private useMonitorProfile = false

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
    private scanEditMode = false

    private stages = new Map<number, GPUTexture>()
    private scratch: GPUTexture[] = []
    private base: GPUTexture | null = null
    private procW = 0
    private procH = 0
    private procFrac = 0
    private processed: GPUTexture | null = null
    private processedFor: string | null = null
    private baseFor: string | null = null

    private lastModel = new Float32Array(9)
    private lastMetrics: { cw: number; ch: number } = { cw: 0, ch: 0 }

    private histogramCallbacks = new Set<HistogramCallback>()
    private histogramBusy = false
    private histogramLast = 0
    private mirror: { data: Float32Array; width: number; height: number } | null = null
    private mirrorBusy = false
    private mirrorLast = 0
    private disposed = false

    private constructor(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, displaySpace: 'display-p3' | 'srgb') {
        this.canvas = canvas
        this.device = device
        this.context = context
        this.displaySpace = displaySpace
        this.canvasFormat = navigator.gpu.getPreferredCanvasFormat()
        this.maxTextureSize = Math.min(device.limits.maxTextureDimension2D, 16384)
        this.rec2020ToDisplayCol = toColumnMajor(displaySpace === 'display-p3' ? REC2020_TO_P3 : REC2020_TO_SRGB)
        this.srgbToDisplayCol = toColumnMajor(SRGB_TO_P3)
        this.buildResources()
    }

    static async create(canvas: HTMLCanvasElement) {
        if (typeof navigator === 'undefined' || !navigator.gpu) throw new Error('webgpu unavailable')
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
        if (!adapter) throw new Error('webgpu adapter unavailable')
        const device = await adapter.requestDevice()
        device.onuncapturederror = (event) => console.error('webgpu uncaptured error:', event.error.message)
        const context = canvas.getContext('webgpu')
        if (!context) {
            device.destroy()
            throw new Error('webgpu context unavailable')
        }
        const format = navigator.gpu.getPreferredCanvasFormat()
        let displaySpace: 'display-p3' | 'srgb' = 'srgb'
        try {
            context.configure({ device, format, alphaMode: 'opaque', colorSpace: 'display-p3' })
            displaySpace = 'display-p3'
        } catch {
            context.configure({ device, format, alphaMode: 'opaque' })
        }
        return new WebGpuRenderer(canvas, device, context, displaySpace)
    }

    private buildResources() {
        const device = this.device
        this.quadBuffer = device.createBuffer({ size: QUAD.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
        device.queue.writeBuffer(this.quadBuffer, 0, QUAD)
        this.linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
        this.nearestSampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' })

        const pass8Module = device.createShaderModule({ code: WGSL_PASS8 })
        this.pass8Pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: pass8Module,
                entryPoint: 'vs',
                buffers: [
                    {
                        arrayStride: 16,
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x2' },
                            { shaderLocation: 1, offset: 8, format: 'float32x2' },
                        ],
                    },
                ],
            },
            fragment: { module: pass8Module, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] },
            primitive: { topology: 'triangle-strip' },
        })
        this.histogramPipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: device.createShaderModule({ code: WGSL_HISTOGRAM }), entryPoint: 'cs' },
        })
        this.nrComputePipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: device.createShaderModule({ code: WGSL_NR_COMPUTE }), entryPoint: 'cs' },
        })

        this.baseLut = this.createCurveTexture(buildBaseCurveLut(256, 'standard'))
        this.baseLutStandard = this.createCurveTexture(buildBaseCurveLut(256, 'standard'))
        this.toneLut = this.createToneTexture(buildToneCurveLut(NEUTRAL_EDIT_STATE.curves))
        this.toneLutIdentity = this.createToneTexture(buildToneCurveLut(NEUTRAL_EDIT_STATE.curves))
        this.displayLut = this.createLutTexture(null, 0)
    }

    private fullscreenPipeline(key: string, code: string, format: GPUTextureFormat = PROC_FORMAT) {
        const cacheKey = `${key}:${format}`
        const cached = this.fullscreenPipelines.get(cacheKey)
        if (cached) return cached
        const module = this.device.createShaderModule({ code })
        const pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: { module, entryPoint: 'vs' },
            fragment: { module, entryPoint: 'fs', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
        })
        this.fullscreenPipelines.set(cacheKey, pipeline)
        return pipeline
    }

    private createTexture(width: number, height: number, format: GPUTextureFormat, usage: number) {
        return this.device.createTexture({ size: { width, height }, format, usage })
    }

    private createColorTarget(width: number, height: number) {
        return this.createTexture(
            width,
            height,
            PROC_FORMAT,
            GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
        )
    }

    private createCurveTexture(data: Uint8Array<ArrayBuffer>) {
        const texture = this.createTexture(data.length, 1, 'r8unorm', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST)
        this.device.queue.writeTexture({ texture }, data, { bytesPerRow: data.length }, { width: data.length, height: 1 })
        return texture
    }

    private createToneTexture(data: Uint16Array<ArrayBuffer>) {
        const texture = this.createTexture(TONE_LUT_SIZE, 1, PROC_FORMAT, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST)
        this.device.queue.writeTexture({ texture }, data, { bytesPerRow: TONE_LUT_SIZE * 8 }, { width: TONE_LUT_SIZE, height: 1 })
        return texture
    }

    private createLutTexture(data: Float32Array | null, size: number) {
        if (!data || size <= 1) {
            const texture = this.createTexture(1, 1, PROC_FORMAT, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST)
            this.device.queue.writeTexture({ texture }, new Uint16Array([0, 0, 0, HALF_ONE]), { bytesPerRow: 8 }, { width: 1, height: 1 })
            return texture
        }
        const width = size * size
        const rgba = new Uint16Array(width * size * 4)
        for (let i = 0; i < width * size; i++) {
            rgba[i * 4] = floatToHalf(data[i * 3])
            rgba[i * 4 + 1] = floatToHalf(data[i * 3 + 1])
            rgba[i * 4 + 2] = floatToHalf(data[i * 3 + 2])
            rgba[i * 4 + 3] = HALF_ONE
        }
        const texture = this.createTexture(width, size, PROC_FORMAT, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST)
        this.device.queue.writeTexture({ texture }, rgba, { bytesPerRow: width * 8 }, { width, height: size })
        return texture
    }

    private uniformBuffer(data: Float32Array<ArrayBuffer>) {
        const buffer = this.device.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
        this.device.queue.writeBuffer(buffer, 0, data)
        return buffer
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
        const scanDims = this.displayDims(image)
        const { dispW, dispH } = dispDims(scanDims.w, scanDims.h, this.orientedFlip(image.flip))
        const cw = this.canvas.width
        const ch = this.canvas.height
        return { cw, ch, dispW, dispH, dpr: window.devicePixelRatio || 1, fitScale: computeFitScale(cw, ch, dispW, dispH) }
    }

    private orientedFlip(flip: number) {
        return composeFlip(flip, this.editState.geometry.rotate90)
    }

    private displayDims(image: { width: number; height: number }) {
        return this.scanEditMode ? { w: image.width, h: image.height } : scanOutputDims(image.width, image.height, this.editState.scan)
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
            image.source.destroy()
            this.images.delete(imageId)
        }
    }

    setEditState(state: EditState | null) {
        const next = state ?? NEUTRAL_EDIT_STATE
        const stage = earliestDirtyStage(this.editState, next)
        if (stage < this.rebuildFrom) this.rebuildFrom = stage
        if (next.baseCurve !== this.editState.baseCurve) {
            this.baseLut.destroy()
            this.baseLut = this.createCurveTexture(buildBaseCurveLut(256, next.baseCurve))
        }
        if (next.curves !== this.editState.curves) {
            this.toneLut.destroy()
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

    setScanEditMode(on: boolean) {
        if (this.scanEditMode === on) return
        this.scanEditMode = on
        if (STAGE_GEOMETRY < this.rebuildFrom) this.rebuildFrom = STAGE_GEOMETRY
    }

    setDrawerCanvas(canvas: HTMLCanvasElement | null) {
        this.drawerTexture?.destroy()
        this.drawerTexture = null
        if (!canvas) return
        const texture = this.createTexture(
            canvas.width,
            canvas.height,
            'rgba8unorm',
            GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        )
        this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, { width: canvas.width, height: canvas.height })
        this.drawerTexture = texture
    }

    private drawerPlaceholder() {
        if (this.drawerPlaceholderTex) return this.drawerPlaceholderTex
        this.drawerPlaceholderTex = this.createTexture(1, 1, 'rgba8unorm', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST)
        this.device.queue.writeTexture({ texture: this.drawerPlaceholderTex }, new Uint8Array(4), { bytesPerRow: 4 }, { width: 1, height: 1 })
        return this.drawerPlaceholderTex
    }

    setCropEditMode(on: boolean) {
        this.cropEditMode = on
    }

    onHistogram = (callback: HistogramCallback) => {
        this.histogramCallbacks.add(callback)
        return () => {
            this.histogramCallbacks.delete(callback)
        }
    }

    uploadAeth(upload: LevelUpload & { colorMatrix: number[] | null }, data: Uint16Array) {
        let width = upload.width
        let height = upload.height
        let rgb = data
        if (Math.max(width, height) > this.maxTextureSize) {
            const scale = this.maxTextureSize / Math.max(width, height)
            const targetW = Math.max(1, Math.round(width * scale))
            const targetH = Math.max(1, Math.round(height * scale))
            rgb = downscaleRgbHalf(data, width, height, targetW, targetH)
            width = targetW
            height = targetH
        }
        const previous = this.images.get(upload.imageId)
        const texture = this.createTexture(width, height, PROC_FORMAT, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST)
        writeRgbHalfAsRgba(this.device, texture, rgb, width, height)
        if (previous) previous.source.destroy()
        this.images.set(upload.imageId, {
            imageId: upload.imageId,
            kind: 'aeth',
            width,
            height,
            flip: upload.flip,
            colorMatrixCol: upload.colorMatrix ? toColumnMajor(upload.colorMatrix) : null,
            source: texture,
        })
        if (upload.imageId === this.current) {
            this.processedFor = null
            this.baseFor = null
        }
        return true
    }

    uploadL0(upload: LevelUpload, bitmap: ImageBitmap) {
        if (upload.width > this.maxTextureSize || upload.height > this.maxTextureSize) return false
        const previous = this.images.get(upload.imageId)
        const texture = this.createTexture(
            bitmap.width,
            bitmap.height,
            'rgba8unorm',
            GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        )
        this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, { width: bitmap.width, height: bitmap.height })
        if (previous) previous.source.destroy()
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

    private freeProcBuffers() {
        for (const target of this.stages.values()) target.destroy()
        this.stages.clear()
        for (const target of this.scratch) target.destroy()
        this.scratch = []
        if (this.base) {
            this.base.destroy()
            this.base = null
        }
        this.baseFor = null
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

    private computeProcDims(view: ViewState, metrics: NonNullable<ReturnType<WebGpuRenderer['getMetrics']>>, image: GpuImage) {
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

    private drawFullscreen(
        encoder: GPUCommandEncoder,
        pipeline: GPURenderPipeline,
        target: GPUTexture,
        uniform: Float32Array<ArrayBuffer> | null,
        textures: GPUTexture[],
        sampler: GPUSampler,
        clear = false,
    ) {
        const entries: GPUBindGroupEntry[] = []
        let binding = 0
        if (uniform) entries.push({ binding: binding++, resource: { buffer: this.uniformBuffer(uniform) } })
        for (const texture of textures) entries.push({ binding: binding++, resource: texture.createView() })
        entries.push({ binding, resource: sampler })
        const bindGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: target.createView(),
                    loadOp: clear ? 'clear' : 'load',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(3)
        pass.end()
    }

    private pass1Uniform(colorMatrixCol: Float32Array | null, gains: [number, number, number]) {
        const data = new Float32Array(16)
        writeMat3(data, 0, colorMatrixCol ?? this.identityCol)
        data[12] = gains[0]
        data[13] = gains[1]
        data[14] = gains[2]
        return data
    }

    private pass2Uniform(width: number, height: number, applyScan: boolean) {
        const data = new Float32Array(56)
        writeMat3(data, 0, buildGeometryWarp(this.editState.geometry))
        data[12] = width
        data[13] = height
        const scan = this.editState.scan
        if (applyScan && scan !== null && scan.enabled) {
            data[39] = 1
            data.set(scanCornerArray(scan), 40)
            data.set(scanEdgeArray(scan), 48)
        }
        const pass = this.lensPass
        if (!pass) return data
        const [normX, normY] = lensNormScale(width, height)
        data[14] = normX
        data[15] = normY
        data[16] = pass.distCoeffs[0]
        data[17] = pass.distCoeffs[1]
        data[18] = pass.distCoeffs[2]
        data[19] = 1
        data[20] = pass.tcaR[0]
        data[21] = pass.tcaR[1]
        data[22] = pass.tcaR[2]
        data[23] = pass.hasProfile ? 1 : 0
        data[24] = pass.tcaB[0]
        data[25] = pass.tcaB[1]
        data[26] = pass.tcaB[2]
        data[27] = pass.distModel
        data[28] = pass.vigCoeffs[0]
        data[29] = pass.vigCoeffs[1]
        data[30] = pass.vigCoeffs[2]
        data[31] = pass.distStrength
        data[32] = pass.hasTca ? 1 : 0
        data[33] = pass.tcaModel
        data[34] = pass.tcaStrength
        data[35] = pass.hasVig ? 1 : 0
        data[36] = pass.vigStrength
        data[37] = pass.manualDist
        data[38] = pass.manualVig
        return data
    }

    private pass3Uniform() {
        const t = toneUniforms(this.editState.tone)
        return new Float32Array([t.exposure, t.highlightRecovery, t.highlights, t.shadows, t.whites, t.blacks, t.contrastK, 0])
    }

    private pass5Uniform() {
        const h = hslUniforms(this.editState.color)
        const data = new Float32Array(28)
        data.set(h.hue, 0)
        data.set(h.sat, 8)
        data.set(h.lum, 16)
        data[24] = h.vibrance
        data[25] = h.saturation
        data[26] = h.bw
        return data
    }

    private runNrCompute(encoder: GPUCommandEncoder, input: GPUTexture, output: GPUTexture, width: number, height: number) {
        const n = nrUniforms(this.editState.detail)
        const uniform = new Float32Array([width, height, n.nrLuma, n.nrLumaDetail, n.nrLumaContrast, n.nrColor, n.nrColorDetail, 0])
        const bindGroup = this.device.createBindGroup({
            layout: this.nrComputePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer(uniform) } },
                { binding: 1, resource: input.createView() },
                { binding: 2, resource: output.createView() },
            ],
        })
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.nrComputePipeline)
        pass.setBindGroup(0, bindGroup)
        pass.dispatchWorkgroups(Math.ceil(width / NR_COMPUTE_WORKGROUP), Math.ceil(height / NR_COMPUTE_WORKGROUP))
        pass.end()
    }

    private sharpenUniform(texel: [number, number]) {
        const s = sharpenUniforms(this.editState.detail)
        return new Float32Array([texel[0], texel[1], s.amount, s.radius, s.detail, s.masking, 0, 0])
    }

    private pass7Uniform(texel: [number, number]) {
        const e = effectsUniforms(this.editState.effects)
        return new Float32Array([
            texel[0],
            texel[1],
            e.clarity,
            e.dehaze,
            e.vignetteAmount,
            e.vignetteMidpoint,
            e.vignetteRoundness,
            e.vignetteFeather,
            e.grainAmount,
            e.grainSize,
            e.grainRoughness,
            1,
        ])
    }

    private runStage(encoder: GPUCommandEncoder, id: number, input: GPUTexture, image: GpuImage) {
        const texel: [number, number] = [1 / this.procW, 1 / this.procH]
        if (id === STAGE_WB) {
            const target = this.stageTarget(id)
            const pipeline = this.fullscreenPipeline('pass1', WGSL_PASS1)
            this.drawFullscreen(
                encoder,
                pipeline,
                target,
                this.pass1Uniform(image.colorMatrixCol, wbGainsFromState(this.editState.wb)),
                [input],
                this.linearSampler,
                true,
            )
            return target
        }
        if (id === STAGE_GEOMETRY) {
            const target = this.stageTarget(id)
            const pipeline = this.fullscreenPipeline('pass2', WGSL_PASS2)
            this.drawFullscreen(
                encoder,
                pipeline,
                target,
                this.pass2Uniform(this.procW, this.procH, !this.scanEditMode),
                [input],
                this.linearSampler,
                true,
            )
            return target
        }
        if (id === STAGE_TONE) {
            const target = this.stageTarget(id)
            const pipeline = this.fullscreenPipeline('pass3', WGSL_PASS3)
            this.drawFullscreen(encoder, pipeline, target, this.pass3Uniform(), [input], this.linearSampler, true)
            return target
        }
        if (id === STAGE_CURVE) {
            const target = this.stageTarget(id)
            const pipeline = this.fullscreenPipeline('pass4', WGSL_PASS4)
            this.drawFullscreen(encoder, pipeline, target, null, [input, this.baseLut, this.toneLut], this.linearSampler, true)
            return target
        }
        if (id === STAGE_COLOR) {
            const target = this.stageTarget(id)
            const pipeline = this.fullscreenPipeline('pass5', WGSL_PASS5)
            this.drawFullscreen(encoder, pipeline, target, this.pass5Uniform(), [input], this.linearSampler, true)
            return target
        }
        if (id === STAGE_DETAIL) {
            const target = this.stageTarget(id)
            const detail = this.editState.detail
            const nrActive = detail.nrLuminance > 0 || detail.nrColor > 0
            const sharpenActive = detail.sharpenAmount > 0
            let stageInput = input
            if (nrActive) {
                const dst = sharpenActive ? this.scratchTarget(0) : target
                this.runNrCompute(encoder, stageInput, dst, this.procW, this.procH)
                stageInput = dst
            }
            if (sharpenActive) {
                this.drawFullscreen(
                    encoder,
                    this.fullscreenPipeline('sharpen', WGSL_SHARPEN),
                    target,
                    this.sharpenUniform(texel),
                    [stageInput],
                    this.linearSampler,
                    true,
                )
            }
            return target
        }
        const target = this.stageTarget(id)
        this.drawFullscreen(
            encoder,
            this.fullscreenPipeline('pass7', WGSL_PASS7),
            target,
            this.pass7Uniform(texel),
            [input],
            this.linearSampler,
            true,
        )
        return target
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

    private runChain(encoder: GPUCommandEncoder, image: GpuImage, from: number) {
        const active = this.activeStages()
        let input = image.source
        let last = image.source
        for (const id of active) {
            if (id < from) {
                const cached = this.stages.get(id)
                if (cached) {
                    input = cached
                    last = cached
                }
                continue
            }
            last = this.runStage(encoder, id, input, image)
            input = last
        }
        this.processed = last
    }

    private buildBase(encoder: GPUCommandEncoder, image: GpuImage) {
        if (!this.base) this.base = this.createColorTarget(this.procW, this.procH)
        const inter = this.scratchTarget(1)
        this.drawFullscreen(
            encoder,
            this.fullscreenPipeline('pass1', WGSL_PASS1),
            inter,
            this.pass1Uniform(image.colorMatrixCol, wbGainsFromState(NEUTRAL_EDIT_STATE.wb)),
            [image.source],
            this.linearSampler,
            true,
        )
        this.drawFullscreen(
            encoder,
            this.fullscreenPipeline('pass4', WGSL_PASS4),
            this.base,
            null,
            [inter, this.baseLutStandard, this.toneLutIdentity],
            this.linearSampler,
            true,
        )
        this.baseFor = image.imageId
    }

    private pass8Uniform(
        model: Float32Array,
        sourceKind: number,
        hasBase: boolean,
        useLut: boolean,
        split: CompareSplit,
        canvasW: number,
        canvasH: number,
        drawerOn: boolean,
    ) {
        const crop = this.editState.crop
        const cropMode = crop && crop.enabled ? (this.cropEditMode ? 2 : 1) : 0
        const data = new Float32Array(68)
        writeMat3(data, 0, model)
        writeMat3(data, 12, this.rec2020ToDisplayCol)
        writeMat3(data, 24, this.srgbToDisplayCol)
        data[36] = split ? 1 : 0
        data[37] = split?.axis === 'y' ? 1 : 0
        data[38] = split?.position ?? 0
        data[39] = sourceKind
        data[40] = crop?.left ?? 0
        data[41] = crop?.top ?? 0
        data[42] = crop?.right ?? 1
        data[43] = crop?.bottom ?? 1
        data[44] = canvasW
        data[45] = canvasH
        data[46] = this.displaySpace === 'display-p3' ? 1 : 0
        data[47] = CLIP_MODE[this.clipMode]
        data[48] = hasBase ? 1 : 0
        data[49] = useLut ? 1 : 0
        data[50] = Math.max(this.lutSize, 2)
        data[51] = cropMode
        writeMat3(data, 52, this.srgbToRec2020Col)
        data[64] = drawerOn ? 1 : 0
        return data
    }

    private drawPass8(
        encoder: GPUCommandEncoder,
        canvasView: GPUTextureView,
        uniform: Float32Array<ArrayBuffer>,
        tex: GPUTexture,
        baseTex: GPUTexture,
        sampler: GPUSampler,
        loadOp: GPULoadOp,
        viewport: { x: number; w: number; h: number } | null,
    ) {
        const bindGroup = this.device.createBindGroup({
            layout: this.pass8Pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer(uniform) } },
                { binding: 1, resource: tex.createView() },
                { binding: 2, resource: baseTex.createView() },
                { binding: 3, resource: this.displayLut.createView() },
                { binding: 4, resource: sampler },
                { binding: 5, resource: (this.drawerTexture ?? this.drawerPlaceholder()).createView() },
            ],
        })
        const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: canvasView, loadOp, storeOp: 'store', clearValue: { r: BG, g: BG, b: BG, a: 1 } }],
        })
        if (viewport) pass.setViewport(viewport.x, 0, viewport.w, viewport.h, 0, 1)
        pass.setPipeline(this.pass8Pipeline)
        pass.setVertexBuffer(0, this.quadBuffer)
        pass.setBindGroup(0, bindGroup)
        pass.draw(4)
        pass.end()
    }

    render(view: ViewState) {
        if (this.disposed) return
        const encoder = this.device.createCommandEncoder()
        const canvasView = this.context.getCurrentTexture().createView()

        if (!this.current) {
            this.clearCanvas(encoder, canvasView)
            this.device.queue.submit([encoder.finish()])
            return
        }
        const image = this.images.get(this.current)
        const metrics = this.getMetrics()
        if (!image || !metrics) {
            this.clearCanvas(encoder, canvasView)
            this.device.queue.submit([encoder.finish()])
            return
        }

        let compareBase: GPUTexture | null = null
        if (image.kind === 'l0') {
            this.processed = image.source
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
                this.runChain(encoder, image, this.rebuildFrom)
                this.rebuildFrom = STAGE_NONE
                this.processedFor = image.imageId
                this.baseFor = null
            }
            if (this.compareSplit || this.sideBySide) {
                if (this.baseFor !== image.imageId) this.buildBase(encoder, image)
                compareBase = this.base
            }
        }
        if (!this.processed) {
            this.clearCanvas(encoder, canvasView)
            this.device.queue.submit([encoder.finish()])
            return
        }

        const nearest = viewScale(view, metrics) > metrics.dpr + 0.001
        const sampler = nearest ? this.nearestSampler : this.linearSampler
        if (this.sideBySide && image.kind !== 'l0' && compareBase) {
            const cw = this.canvas.width
            const ch = this.canvas.height
            const halfW = Math.floor(cw / 2)
            const paneMetrics = { ...metrics, cw: halfW, fitScale: computeFitScale(halfW, ch, metrics.dispW, metrics.dispH) }
            const paneDims = this.displayDims(image)
            const model = buildModelMatrix(view, paneMetrics, paneDims.w, paneDims.h, this.orientedFlip(image.flip))
            this.lastModel = model
            this.lastMetrics = { cw: halfW, ch }
            const paneSampler = viewScale(view, paneMetrics) > paneMetrics.dpr + 0.001 ? this.nearestSampler : this.linearSampler
            const uniform = this.pass8Uniform(model, 0, false, this.useMonitorProfile && this.lutSize > 0, null, cw, ch, this.drawerTexture !== null)
            this.drawPass8(encoder, canvasView, uniform, compareBase, compareBase, paneSampler, 'clear', { x: 0, w: halfW, h: ch })
            this.drawPass8(encoder, canvasView, uniform, this.processed, this.processed, paneSampler, 'load', { x: halfW, w: cw - halfW, h: ch })
        } else {
            const dims = this.displayDims(image)
            const model = buildModelMatrix(view, metrics, dims.w, dims.h, this.orientedFlip(image.flip))
            this.lastModel = model
            this.lastMetrics = { cw: metrics.cw, ch: metrics.ch }
            const uniform = this.pass8Uniform(
                model,
                image.kind === 'l0' ? 1 : 0,
                compareBase != null,
                this.useMonitorProfile && this.lutSize > 0 && image.kind !== 'l0',
                this.compareSplit,
                this.canvas.width,
                this.canvas.height,
                this.drawerTexture !== null && image.kind !== 'l0',
            )
            this.drawPass8(encoder, canvasView, uniform, this.processed, compareBase ?? this.processed, sampler, 'clear', null)
        }

        this.device.queue.submit([encoder.finish()])
        if (image.kind !== 'l0') {
            this.sampleHistogram()
            this.updateMirror()
        }
    }

    private clearCanvas(encoder: GPUCommandEncoder, canvasView: GPUTextureView) {
        const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: canvasView, loadOp: 'clear', storeOp: 'store', clearValue: { r: BG, g: BG, b: BG, a: 1 } }],
        })
        pass.end()
    }

    private sampleHistogram() {
        if (this.histogramCallbacks.size === 0 || !this.processed || this.histogramBusy) return
        const now = performance.now()
        if (now - this.histogramLast < HISTOGRAM_THROTTLE_MS) return
        this.histogramLast = now
        this.histogramBusy = true
        const device = this.device
        const bins = device.createBuffer({ size: 1024 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST })
        const readback = device.createBuffer({ size: 1024 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
        const uniform = new Float32Array(16)
        writeMat3(uniform, 0, this.rec2020ToDisplayCol)
        uniform[12] = this.procW
        uniform[13] = this.procH
        const bindGroup = device.createBindGroup({
            layout: this.histogramPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer(uniform) } },
                { binding: 1, resource: this.processed.createView() },
                { binding: 2, resource: { buffer: bins } },
            ],
        })
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.histogramPipeline)
        pass.setBindGroup(0, bindGroup)
        pass.dispatchWorkgroups(Math.ceil(this.procW / 16), Math.ceil(this.procH / 16))
        pass.end()
        encoder.copyBufferToBuffer(bins, 0, readback, 0, 1024 * 4)
        device.queue.submit([encoder.finish()])
        readback
            .mapAsync(GPUMapMode.READ)
            .then(() => {
                const raw = new Uint32Array(readback.getMappedRange().slice(0))
                readback.unmap()
                const hist: Histogram = {
                    r: raw.slice(0, 256),
                    g: raw.slice(256, 512),
                    b: raw.slice(512, 768),
                    luma: raw.slice(768, 1024),
                }
                for (const callback of this.histogramCallbacks) callback(hist)
            })
            .catch(() => undefined)
            .finally(() => {
                bins.destroy()
                readback.destroy()
                this.histogramBusy = false
            })
    }

    private updateMirror() {
        if (!this.processed || this.mirrorBusy) return
        const now = performance.now()
        if (now - this.mirrorLast < MIRROR_THROTTLE_MS) return
        this.mirrorLast = now
        this.mirrorBusy = true
        const device = this.device
        const scale = Math.min(1, MIRROR_MAX / Math.max(this.procW, this.procH))
        const mw = Math.max(1, Math.round(this.procW * scale))
        const mh = Math.max(1, Math.round(this.procH * scale))
        const encoder = device.createCommandEncoder()
        let source = this.processed
        let mirrorTex: GPUTexture | null = null
        if (scale < 1) {
            mirrorTex = this.createColorTarget(mw, mh)
            this.drawFullscreen(
                encoder,
                this.fullscreenPipeline('orient', WGSL_ORIENT),
                mirrorTex,
                new Float32Array([0, 0, 0, 0]),
                [this.processed],
                this.linearSampler,
                true,
            )
            source = mirrorTex
        }
        const bytesPerRow = alignBytesPerRow(mw * 8)
        const readback = device.createBuffer({ size: bytesPerRow * mh, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
        encoder.copyTextureToBuffer({ texture: source }, { buffer: readback, bytesPerRow }, { width: mw, height: mh })
        device.queue.submit([encoder.finish()])
        readback
            .mapAsync(GPUMapMode.READ)
            .then(() => {
                const raw = new Uint16Array(readback.getMappedRange().slice(0))
                readback.unmap()
                const data = new Float32Array(mw * mh * 4)
                const stride = bytesPerRow / 2
                for (let row = 0; row < mh; row++) {
                    for (let col = 0; col < mw * 4; col++) data[row * mw * 4 + col] = halfToFloat(raw[row * stride + col])
                }
                this.mirror = { data, width: mw, height: mh }
            })
            .catch(() => undefined)
            .finally(() => {
                mirrorTex?.destroy()
                readback.destroy()
                this.mirrorBusy = false
            })
    }

    readProcessedSrgb() {
        const mirror = this.mirror
        if (!mirror) return null
        return { data: floatRgbaToSrgbBytes(mirror.data, mirror.width * mirror.height), width: mirror.width, height: mirror.height }
    }

    samplePixel(canvasX: number, canvasY: number) {
        const mirror = this.mirror
        if (!mirror || this.procW === 0) return null
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
        const px = Math.min(mirror.width - 1, Math.max(0, Math.round(uvX * mirror.width)))
        const py = Math.min(mirror.height - 1, Math.max(0, Math.round(uvY * mirror.height)))
        const x0 = Math.max(0, px - 2)
        const y0 = Math.max(0, py - 2)
        const w = Math.min(5, mirror.width - x0)
        const h = Math.min(5, mirror.height - y0)
        let r = 0
        let g = 0
        let bl = 0
        for (let row = y0; row < y0 + h; row++) {
            for (let col = x0; col < x0 + w; col++) {
                const index = (row * mirror.width + col) * 4
                r += mirror.data[index]
                g += mirror.data[index + 1]
                bl += mirror.data[index + 2]
            }
        }
        const count = w * h
        return { r: r / count, g: g / count, b: bl / count }
    }

    setDisplayLut(size: number, data: Float32Array | null) {
        this.displayLut.destroy()
        this.lutSize = data && size > 1 ? size : 0
        this.displayLut = this.createLutTexture(data, this.lutSize)
    }

    setUseMonitorProfile(on: boolean) {
        this.useMonitorProfile = on
    }

    hasDisplayLut() {
        return this.lutSize > 0
    }

    async renderExport(
        source: { width: number; height: number; data: Uint16Array; colorMatrix: number[] | null; flip: number },
        state: EditState,
        lensProfile: LensProfileMatch | null,
        drawer?: HTMLCanvasElement | null,
    ): Promise<ExportFrame> {
        const previousState = this.editState
        const previousLens = { imageId: this.lensProfileImageId, profile: this.lensProfile, pass: this.lensPass, sig: this.lensSig }
        this.editState = state
        this.lensPass = buildLensPass(state.lens, lensProfile)
        const baseLut = this.createCurveTexture(buildBaseCurveLut(256, state.baseCurve))
        const toneLut = this.createToneTexture(buildToneCurveLut(state.curves))

        let width = source.width
        let height = source.height
        let rgb = source.data
        if (Math.max(width, height) > this.maxTextureSize) {
            const scale = this.maxTextureSize / Math.max(width, height)
            const targetW = Math.max(1, Math.round(width * scale))
            const targetH = Math.max(1, Math.round(height * scale))
            rgb = downscaleRgbHalf(rgb, width, height, targetW, targetH)
            width = targetW
            height = targetH
        }
        const sourceTex = this.createTexture(width, height, PROC_FORMAT, GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST)
        writeRgbHalfAsRgba(this.device, sourceTex, rgb, width, height)

        const owned: GPUTexture[] = [sourceTex, baseLut, toneLut]
        const texel: [number, number] = [1 / width, 1 / height]
        const makeTarget = () => {
            const target = this.createColorTarget(width, height)
            owned.push(target)
            return target
        }
        const encoder = this.device.createCommandEncoder()
        const active: number[] = []
        for (let stage = 0; stage < STAGE_COUNT; stage++) {
            const on = stage === STAGE_GEOMETRY ? stageActive(stage, state) || this.lensPass !== null : stageActive(stage, state)
            if (on) active.push(stage)
        }
        const primary = makeTarget()
        const secondary = makeTarget()
        let scratch: GPUTexture | null = null
        let input = sourceTex
        let last = sourceTex
        let output = primary
        const colorMatrixCol = source.colorMatrix ? toColumnMajor(source.colorMatrix) : null
        for (const id of active) {
            if (id === STAGE_WB) {
                this.drawFullscreen(
                    encoder,
                    this.fullscreenPipeline('pass1', WGSL_PASS1),
                    output,
                    this.pass1Uniform(colorMatrixCol, wbGainsFromState(state.wb)),
                    [input],
                    this.linearSampler,
                    true,
                )
            } else if (id === STAGE_GEOMETRY) {
                this.drawFullscreen(
                    encoder,
                    this.fullscreenPipeline('pass2', WGSL_PASS2),
                    output,
                    this.pass2Uniform(width, height, true),
                    [input],
                    this.linearSampler,
                    true,
                )
            } else if (id === STAGE_TONE) {
                this.drawFullscreen(
                    encoder,
                    this.fullscreenPipeline('pass3', WGSL_PASS3),
                    output,
                    this.pass3Uniform(),
                    [input],
                    this.linearSampler,
                    true,
                )
            } else if (id === STAGE_CURVE) {
                this.drawFullscreen(
                    encoder,
                    this.fullscreenPipeline('pass4', WGSL_PASS4),
                    output,
                    null,
                    [input, baseLut, toneLut],
                    this.linearSampler,
                    true,
                )
            } else if (id === STAGE_COLOR) {
                this.drawFullscreen(
                    encoder,
                    this.fullscreenPipeline('pass5', WGSL_PASS5),
                    output,
                    this.pass5Uniform(),
                    [input],
                    this.linearSampler,
                    true,
                )
            } else if (id === STAGE_DETAIL) {
                const detail = state.detail
                const nrActive = detail.nrLuminance > 0 || detail.nrColor > 0
                const sharpenActive = detail.sharpenAmount > 0
                let stageInput = input
                if (nrActive) {
                    if (sharpenActive && !scratch) scratch = makeTarget()
                    const dst = sharpenActive && scratch ? scratch : output
                    this.runNrCompute(encoder, stageInput, dst, width, height)
                    stageInput = dst
                }
                if (sharpenActive) {
                    this.drawFullscreen(
                        encoder,
                        this.fullscreenPipeline('sharpen', WGSL_SHARPEN),
                        output,
                        this.sharpenUniform(texel),
                        [stageInput],
                        this.linearSampler,
                        true,
                    )
                }
            } else {
                this.drawFullscreen(
                    encoder,
                    this.fullscreenPipeline('pass7', WGSL_PASS7),
                    output,
                    this.pass7Uniform(texel),
                    [input],
                    this.linearSampler,
                    true,
                )
            }
            last = output
            input = output
            output = output === primary ? secondary : primary
        }

        if (drawer) {
            const drawerTexture = this.createTexture(
                drawer.width,
                drawer.height,
                'rgba8unorm',
                GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            )
            owned.push(drawerTexture)
            this.device.queue.copyExternalImageToTexture(
                { source: drawer },
                { texture: drawerTexture },
                { width: drawer.width, height: drawer.height },
            )
            const composited = makeTarget()
            const drawerUniform = new Float32Array(12)
            writeMat3(drawerUniform, 0, this.srgbToRec2020Col)
            this.drawFullscreen(
                encoder,
                this.fullscreenPipeline('drawer', WGSL_DRAWER),
                composited,
                drawerUniform,
                [last, drawerTexture],
                this.linearSampler,
                true,
            )
            last = composited
        }

        const exportFlip = composeFlip(source.flip, state.geometry.rotate90)
        const scanDims = scanOutputDims(width, height, state.scan)
        const dims = dispDims(scanDims.w, scanDims.h, exportFlip)
        const oriented = this.createColorTarget(dims.dispW, dims.dispH)
        owned.push(oriented)
        this.drawFullscreen(
            encoder,
            this.fullscreenPipeline('orient', WGSL_ORIENT),
            oriented,
            new Float32Array([exportFlip, 0, 0, 0]),
            [last],
            this.linearSampler,
            true,
        )
        const bytesPerRow = alignBytesPerRow(dims.dispW * 8)
        const readback = this.device.createBuffer({ size: bytesPerRow * dims.dispH, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
        encoder.copyTextureToBuffer({ texture: oriented }, { buffer: readback, bytesPerRow }, { width: dims.dispW, height: dims.dispH })
        this.device.queue.submit([encoder.finish()])
        await readback.mapAsync(GPUMapMode.READ)
        const raw = new Uint16Array(readback.getMappedRange().slice(0))
        readback.unmap()
        readback.destroy()
        for (const texture of owned) texture.destroy()

        this.editState = previousState
        this.lensProfileImageId = previousLens.imageId
        this.lensProfile = previousLens.profile
        this.lensPass = previousLens.pass
        this.lensSig = previousLens.sig

        const stride = bytesPerRow / 2
        const data = new Uint16Array(dims.dispW * dims.dispH * 4)
        for (let row = 0; row < dims.dispH; row++) {
            data.set(raw.subarray(row * stride, row * stride + dims.dispW * 4), row * dims.dispW * 4)
        }
        return { width: dims.dispW, height: dims.dispH, data }
    }

    reinit() {}

    dispose() {
        this.disposed = true
        for (const image of this.images.values()) image.source.destroy()
        this.images.clear()
        this.freeProcBuffers()
        this.baseLut.destroy()
        this.baseLutStandard.destroy()
        this.toneLut.destroy()
        this.toneLutIdentity.destroy()
        this.displayLut.destroy()
        this.drawerTexture?.destroy()
        this.drawerPlaceholderTex?.destroy()
        this.quadBuffer.destroy()
        this.histogramCallbacks.clear()
        this.device.destroy()
    }
}
