import type { DrawerAdjust } from '../types/DrawerAdjust'
import type { DrawerBlendMode } from '../types/DrawerBlendMode'
import type { DrawerLayer } from '../types/DrawerLayer'
import type { DrawerObject } from '../types/DrawerObject'
import type { DrawerState } from '../types/DrawerState'

const DRAWER_RASTER_MAX_EDGE = 4096

const FILL_TOLERANCE = 32

const ARROW_HEAD_SPREAD_RAD = Math.PI / 7

const ARROW_HEAD_LENGTH_FACTOR = 6

const STAMP_SPACING_FACTOR = 0.35

const BLUR_DOWNSCALE = 8

const RGBA_CHANNELS = 4

const HUE_LUMA: [number, number, number] = [0.213, 0.715, 0.072]

const DRAWER_BLEND_OPS = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay' } as const satisfies Record<
    DrawerBlendMode,
    GlobalCompositeOperation
>

export type DrawerPhoto = { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }

type Vec2 = readonly [number, number]

type PixelGrid = { data: Uint8ClampedArray; width: number; height: number }

export const hasDrawerContent = (drawer: DrawerState | null | undefined) =>
    drawer?.layers.some((layer) => layer.visible && layer.objects.length > 0) === true

export const drawerNeedsPhoto = (drawer: DrawerState | null | undefined) =>
    drawer?.layers.some((layer) => layer.visible && layer.objects.some((object) => object.kind === 'clone' || object.kind === 'blur')) === true

export const drawerSizePx = (size: number, width: number, height: number) => Math.max(1, (size / 100) * Math.max(width, height))

export const drawerRasterDims = (width: number, height: number, maxEdge = DRAWER_RASTER_MAX_EDGE) => {
    const longEdge = Math.max(width, height)
    if (longEdge <= maxEdge) return { w: width, h: height }
    const scale = maxEdge / longEdge
    return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) }
}

export const arrowHeadPoints = (from: Vec2, to: Vec2, headLength: number) => {
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
    return [
        [to[0] - headLength * Math.cos(angle - ARROW_HEAD_SPREAD_RAD), to[1] - headLength * Math.sin(angle - ARROW_HEAD_SPREAD_RAD)],
        [to[0] - headLength * Math.cos(angle + ARROW_HEAD_SPREAD_RAD), to[1] - headLength * Math.sin(angle + ARROW_HEAD_SPREAD_RAD)],
    ] as const
}

export const hexToRgb = (hex: string): [number, number, number] => {
    const value = Number.parseInt(hex.replace('#', ''), 16)
    if (Number.isNaN(value)) return [0, 0, 0]
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/**
 * Scanline flood fill over straight-alpha RGBA pixels. Region growth compares
 * every channel against the seed pixel within FILL_TOLERANCE; an optional mask
 * (non-zero = fillable) restricts growth to a selection.
 */
export const floodFillData = (grid: PixelGrid, seedX: number, seedY: number, rgb: [number, number, number], mask: Uint8Array | null = null) => {
    const { data, width, height } = grid
    if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return false
    if (mask && mask[seedY * width + seedX] === 0) return false
    const seedIndex = (seedY * width + seedX) * RGBA_CHANNELS
    const seed = [data[seedIndex], data[seedIndex + 1], data[seedIndex + 2], data[seedIndex + 3]]
    const alreadyFilled = seed[0] === rgb[0] && seed[1] === rgb[1] && seed[2] === rgb[2] && seed[3] === 0xff
    if (alreadyFilled) return false
    const matches = (x: number, y: number) => {
        const pixel = y * width + x
        if (mask && mask[pixel] === 0) return false
        const index = pixel * RGBA_CHANNELS
        return (
            Math.abs(data[index] - seed[0]) <= FILL_TOLERANCE &&
            Math.abs(data[index + 1] - seed[1]) <= FILL_TOLERANCE &&
            Math.abs(data[index + 2] - seed[2]) <= FILL_TOLERANCE &&
            Math.abs(data[index + 3] - seed[3]) <= FILL_TOLERANCE
        )
    }
    const visited = new Uint8Array(width * height)
    const paint = (x: number, y: number) => {
        const pixel = y * width + x
        visited[pixel] = 1
        const index = pixel * RGBA_CHANNELS
        data[index] = rgb[0]
        data[index + 1] = rgb[1]
        data[index + 2] = rgb[2]
        data[index + 3] = 0xff
    }
    const stack: [number, number][] = [[seedX, seedY]]
    while (stack.length > 0) {
        const next = stack.pop()
        if (!next) break
        const [x, y] = next
        if (visited[y * width + x] === 1 || !matches(x, y)) continue
        let left = x
        while (left > 0 && visited[y * width + left - 1] === 0 && matches(left - 1, y)) left--
        let right = x
        while (right < width - 1 && visited[y * width + right + 1] === 0 && matches(right + 1, y)) right++
        for (let column = left; column <= right; column++) {
            paint(column, y)
            if (y > 0 && visited[(y - 1) * width + column] === 0 && matches(column, y - 1)) stack.push([column, y - 1])
            if (y < height - 1 && visited[(y + 1) * width + column] === 0 && matches(column, y + 1)) stack.push([column, y + 1])
        }
    }
    return true
}

/**
 * In-place brightness/contrast/saturation/hue pass over straight-alpha sRGB
 * pixels. Values follow the DrawerAdjust ranges (percent, hue in degrees).
 */
export const adjustPixels = (data: Uint8ClampedArray, adjust: DrawerAdjust) => {
    const brightness = 1 + adjust.brightness / 100
    const contrast = 1 + adjust.contrast / 100
    const saturation = 1 + adjust.saturation / 100
    const radians = (adjust.hue * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const [lr, lg, lb] = HUE_LUMA
    const hueMatrix = [
        lr + cos * (1 - lr) + sin * -lr,
        lg + cos * -lg + sin * -lg,
        lb + cos * -lb + sin * (1 - lb),
        lr + cos * -lr + sin * 0.143,
        lg + cos * (1 - lg) + sin * 0.14,
        lb + cos * -lb + sin * -0.283,
        lr + cos * -lr + sin * -(1 - lr),
        lg + cos * -lg + sin * lg,
        lb + cos * (1 - lb) + sin * lb,
    ]
    for (let index = 0; index < data.length; index += RGBA_CHANNELS) {
        if (data[index + 3] === 0) continue
        let r = data[index]
        let g = data[index + 1]
        let b = data[index + 2]
        if (adjust.hue !== 0) {
            const hr = hueMatrix[0] * r + hueMatrix[1] * g + hueMatrix[2] * b
            const hg = hueMatrix[3] * r + hueMatrix[4] * g + hueMatrix[5] * b
            const hb = hueMatrix[6] * r + hueMatrix[7] * g + hueMatrix[8] * b
            r = hr
            g = hg
            b = hb
        }
        const luma = HUE_LUMA[0] * r + HUE_LUMA[1] * g + HUE_LUMA[2] * b
        r = luma + (r - luma) * saturation
        g = luma + (g - luma) * saturation
        b = luma + (b - luma) * saturation
        const mid = 128
        data[index] = (r * brightness - mid) * contrast + mid
        data[index + 1] = (g * brightness - mid) * contrast + mid
        data[index + 2] = (b * brightness - mid) * contrast + mid
    }
}

const isAdjustNeutral = (adjust: DrawerAdjust | null) =>
    !adjust || (adjust.brightness === 0 && adjust.contrast === 0 && adjust.saturation === 0 && adjust.hue === 0)

const createCanvas = (width: number, height: number) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

const applyClipPath = (ctx: CanvasRenderingContext2D, clip: Vec2[] | null | undefined, width: number, height: number) => {
    if (!clip || clip.length < 3) return
    ctx.beginPath()
    ctx.moveTo(clip[0][0] * width, clip[0][1] * height)
    for (const point of clip.slice(1)) ctx.lineTo(point[0] * width, point[1] * height)
    ctx.closePath()
    ctx.clip()
}

const clipMask = (clip: Vec2[], width: number, height: number) => {
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(clip[0][0] * width, clip[0][1] * height)
    for (const point of clip.slice(1)) ctx.lineTo(point[0] * width, point[1] * height)
    ctx.closePath()
    ctx.fill()
    const image = ctx.getImageData(0, 0, width, height)
    const mask = new Uint8Array(width * height)
    for (let pixel = 0; pixel < mask.length; pixel++) mask[pixel] = image.data[pixel * RGBA_CHANNELS + 3] > 0 ? 1 : 0
    return mask
}

const stampAlongPath = (points: Vec2[], radiusPx: number, width: number, height: number, stamp: (x: number, y: number) => void) => {
    if (points.length === 0) return
    const spacing = Math.max(1, radiusPx * STAMP_SPACING_FACTOR)
    let previous: [number, number] = [points[0][0] * width, points[0][1] * height]
    stamp(previous[0], previous[1])
    for (const point of points.slice(1)) {
        const current: [number, number] = [point[0] * width, point[1] * height]
        const distance = Math.hypot(current[0] - previous[0], current[1] - previous[1])
        const steps = Math.floor(distance / spacing)
        for (let step = 1; step <= steps; step++) {
            const t = (step * spacing) / distance
            stamp(previous[0] + (current[0] - previous[0]) * t, previous[1] + (current[1] - previous[1]) * t)
        }
        if (steps > 0)
            previous = [
                previous[0] + (current[0] - previous[0]) * ((steps * spacing) / distance),
                previous[1] + (current[1] - previous[1]) * ((steps * spacing) / distance),
            ]
    }
}

type PhotoCanvases = { photo: HTMLCanvasElement; blurred: HTMLCanvasElement }

const buildPhotoCanvases = (photo: DrawerPhoto, width: number, height: number): PhotoCanvases | null => {
    const source = createCanvas(photo.width, photo.height)
    const sourceCtx = source.getContext('2d')
    if (!sourceCtx) return null
    sourceCtx.putImageData(new ImageData(photo.data, photo.width, photo.height), 0, 0)
    const scaled = createCanvas(width, height)
    const scaledCtx = scaled.getContext('2d')
    if (!scaledCtx) return null
    scaledCtx.drawImage(source, 0, 0, width, height)
    const small = createCanvas(Math.max(1, Math.round(width / BLUR_DOWNSCALE)), Math.max(1, Math.round(height / BLUR_DOWNSCALE)))
    const smallCtx = small.getContext('2d')
    if (!smallCtx) return null
    smallCtx.drawImage(scaled, 0, 0, small.width, small.height)
    const blurred = createCanvas(width, height)
    const blurredCtx = blurred.getContext('2d')
    if (!blurredCtx) return null
    blurredCtx.imageSmoothingEnabled = true
    blurredCtx.drawImage(small, 0, 0, width, height)
    return { photo: scaled, blurred }
}

const drawStroke = (ctx: CanvasRenderingContext2D, object: Extract<DrawerObject, { kind: 'stroke' }>, width: number, height: number) => {
    if (object.points.length === 0) return
    ctx.globalCompositeOperation = object.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.globalAlpha = object.tool === 'eraser' ? 1 : object.opacity / 100
    const lineWidth = drawerSizePx(object.size, width, height)
    const startX = object.points[0][0] * width
    const startY = object.points[0][1] * height
    if (object.points.length === 1) {
        ctx.fillStyle = object.color
        ctx.beginPath()
        ctx.arc(startX, startY, lineWidth / 2, 0, Math.PI * 2)
        ctx.fill()
        return
    }
    ctx.strokeStyle = object.color
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    for (const point of object.points.slice(1)) ctx.lineTo(point[0] * width, point[1] * height)
    ctx.stroke()
}

const drawShape = (ctx: CanvasRenderingContext2D, object: Extract<DrawerObject, { kind: 'shape' }>, width: number, height: number) => {
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    const lineWidth = drawerSizePx(object.size, width, height)
    const from: Vec2 = [object.from[0] * width, object.from[1] * height]
    const to: Vec2 = [object.to[0] * width, object.to[1] * height]
    ctx.strokeStyle = object.color
    ctx.fillStyle = object.color
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    if (object.shape === 'line' || object.shape === 'arrow') {
        ctx.moveTo(from[0], from[1])
        ctx.lineTo(to[0], to[1])
        ctx.stroke()
        if (object.shape === 'arrow') {
            const [left, right] = arrowHeadPoints(from, to, lineWidth * ARROW_HEAD_LENGTH_FACTOR)
            ctx.beginPath()
            ctx.moveTo(left[0], left[1])
            ctx.lineTo(to[0], to[1])
            ctx.lineTo(right[0], right[1])
            ctx.stroke()
        }
        return
    }
    if (object.shape === 'rect') {
        ctx.rect(Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]))
    } else {
        ctx.ellipse((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, Math.abs(to[0] - from[0]) / 2, Math.abs(to[1] - from[1]) / 2, 0, 0, Math.PI * 2)
    }
    if (object.fill) ctx.fill()
    else ctx.stroke()
}

const drawText = (ctx: CanvasRenderingContext2D, object: Extract<DrawerObject, { kind: 'text' }>, width: number, height: number) => {
    if (object.text.length === 0) return
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.fillStyle = object.color
    ctx.font = `${drawerSizePx(object.size, width, height)}px sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(object.text, object.position[0] * width, object.position[1] * height)
}

const drawFill = (ctx: CanvasRenderingContext2D, object: Extract<DrawerObject, { kind: 'fill' }>, width: number, height: number) => {
    const image = ctx.getImageData(0, 0, width, height)
    const mask = object.clip && object.clip.length >= 3 ? clipMask(object.clip, width, height) : null
    const seedX = Math.min(width - 1, Math.max(0, Math.round(object.seed[0] * width)))
    const seedY = Math.min(height - 1, Math.max(0, Math.round(object.seed[1] * height)))
    if (floodFillData({ data: image.data, width, height }, seedX, seedY, hexToRgb(object.color), mask)) ctx.putImageData(image, 0, 0)
}

const drawClone = (
    ctx: CanvasRenderingContext2D,
    object: Extract<DrawerObject, { kind: 'clone' }>,
    width: number,
    height: number,
    photo: PhotoCanvases,
) => {
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    const radius = drawerSizePx(object.size, width, height) / 2
    stampAlongPath(object.points, radius, width, height, (x, y) => {
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(photo.photo, -object.offset[0] * width, -object.offset[1] * height)
        ctx.restore()
    })
}

const drawBlur = (
    ctx: CanvasRenderingContext2D,
    object: Extract<DrawerObject, { kind: 'blur' }>,
    width: number,
    height: number,
    photo: PhotoCanvases,
) => {
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    const radius = drawerSizePx(object.size, width, height) / 2
    stampAlongPath(object.points, radius, width, height, (x, y) => {
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(photo.blurred, 0, 0)
        ctx.restore()
    })
}

const drawObject = (ctx: CanvasRenderingContext2D, object: DrawerObject, width: number, height: number, photo: PhotoCanvases | null) => {
    const clip = object.kind === 'text' ? null : object.clip
    const clipped = clip !== null && clip !== undefined && clip.length >= 3
    if (clipped && object.kind !== 'fill') {
        ctx.save()
        applyClipPath(ctx, clip, width, height)
    }
    if (object.kind === 'stroke') drawStroke(ctx, object, width, height)
    else if (object.kind === 'shape') drawShape(ctx, object, width, height)
    else if (object.kind === 'text') drawText(ctx, object, width, height)
    else if (object.kind === 'fill') drawFill(ctx, object, width, height)
    else if (object.kind === 'clone' && photo) drawClone(ctx, object, width, height, photo)
    else if (object.kind === 'blur' && photo) drawBlur(ctx, object, width, height, photo)
    if (clipped && object.kind !== 'fill') ctx.restore()
}

type LayerCacheEntry = { width: number; height: number; photo: DrawerPhoto | null; canvas: HTMLCanvasElement }

const layerContentCache = new WeakMap<DrawerLayer['objects'], LayerCacheEntry>()

const layerAdjustedCache = new WeakMap<DrawerLayer, LayerCacheEntry>()

const rasterizeLayerContent = (
    layer: DrawerLayer,
    width: number,
    height: number,
    photo: DrawerPhoto | null,
    photoCanvases: () => PhotoCanvases | null,
) => {
    const cached = layerContentCache.get(layer.objects)
    if (cached && cached.width === width && cached.height === height && cached.photo === photo) return cached.canvas
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const needsPhoto = layer.objects.some((object) => object.kind === 'clone' || object.kind === 'blur')
    const resolvedPhoto = needsPhoto ? photoCanvases() : null
    for (const object of layer.objects) drawObject(ctx, object, width, height, resolvedPhoto)
    layerContentCache.set(layer.objects, { width, height, photo, canvas })
    return canvas
}

const rasterizeLayer = (layer: DrawerLayer, width: number, height: number, photo: DrawerPhoto | null, photoCanvases: () => PhotoCanvases | null) => {
    const content = rasterizeLayerContent(layer, width, height, photo, photoCanvases)
    if (!content || isAdjustNeutral(layer.adjust)) return content
    const cached = layerAdjustedCache.get(layer)
    if (cached && cached.width === width && cached.height === height && cached.photo === photo) return cached.canvas
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return content
    ctx.drawImage(content, 0, 0)
    const image = ctx.getImageData(0, 0, width, height)
    if (layer.adjust) adjustPixels(image.data, layer.adjust)
    ctx.putImageData(image, 0, 0)
    layerAdjustedCache.set(layer, { width, height, photo, canvas })
    return canvas
}

export const renderDrawerCanvas = (drawer: DrawerState | null | undefined, width: number, height: number, photo: DrawerPhoto | null = null) => {
    if (!drawer || !hasDrawerContent(drawer)) return null
    const dims = drawerRasterDims(width, height)
    return rasterizeDrawer(drawer, dims.w, dims.h, photo)
}

/**
 * Builds the drawer argument for export engines: a plain canvas when no object
 * references the photo, or a factory invoked with the rendered photo pixels.
 */
export const buildExportDrawer = (drawer: DrawerState | null | undefined, width: number, height: number) => {
    if (!drawer || !hasDrawerContent(drawer)) return null
    if (!drawerNeedsPhoto(drawer)) return renderDrawerCanvas(drawer, width, height)
    return (photo: DrawerPhoto) => renderDrawerCanvas(drawer, width, height, photo)
}

export const rasterizeDrawer = (drawer: DrawerState, width: number, height: number, photo: DrawerPhoto | null = null) => {
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    let photoCache: PhotoCanvases | null = null
    const photoCanvases = () => {
        if (!photo) return null
        photoCache = photoCache ?? buildPhotoCanvases(photo, width, height)
        return photoCache
    }
    for (const layer of drawer.layers) {
        if (!layer.visible || layer.objects.length === 0) continue
        const layerCanvas = rasterizeLayer(layer, width, height, photo, photoCanvases)
        if (!layerCanvas) continue
        ctx.save()
        ctx.globalAlpha = layer.opacity / 100
        ctx.globalCompositeOperation = DRAWER_BLEND_OPS[layer.blend]
        const transform = layer.transform
        if (transform) {
            ctx.translate(width / 2 + (transform.offsetX / 100) * width, height / 2 + (transform.offsetY / 100) * height)
            ctx.rotate((transform.rotate * Math.PI) / 180)
            ctx.scale(transform.scale / 100, transform.scale / 100)
            ctx.translate(-width / 2, -height / 2)
        }
        ctx.drawImage(layerCanvas, 0, 0)
        ctx.restore()
    }
    return canvas
}
