export type ViewState = { fit: boolean; zoom: number; pan: { x: number; y: number } }

export type Metrics = { cw: number; ch: number; dispW: number; dispH: number; dpr: number; fitScale: number }

export type Point = { x: number; y: number }

export const DEFAULT_VIEW: ViewState = { fit: true, zoom: 1, pan: { x: 0, y: 0 } }

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 16

const clamp = (value: number, lo: number, hi: number) => (value < lo ? lo : value > hi ? hi : value)

export const dispDims = (width: number, height: number, flip: number) =>
    flip === 5 || flip === 6 ? { dispW: height, dispH: width } : { dispW: width, dispH: height }

export const flipAngle = (flip: number) => (flip === 3 ? Math.PI : flip === 5 ? Math.PI / 2 : flip === 6 ? -Math.PI / 2 : 0)

export const computeFitScale = (cw: number, ch: number, dispW: number, dispH: number) =>
    dispW > 0 && dispH > 0 ? Math.min(cw / dispW, ch / dispH) : 1

export const viewScale = (view: ViewState, m: Metrics) => (view.fit ? m.fitScale : view.zoom * m.dpr)

export const clampPan = (pan: Point, view: ViewState, m: Metrics) => {
    const scale = viewScale(view, m)
    const maxX = Math.max(0, (scale * m.dispW - m.cw) / 2)
    const maxY = Math.max(0, (scale * m.dispH - m.ch) / 2)
    return { x: clamp(pan.x, -maxX, maxX), y: clamp(pan.y, -maxY, maxY) }
}

export const buildModelMatrix = (view: ViewState, m: Metrics, imgW: number, imgH: number, flip: number) => {
    const scale = viewScale(view, m)
    const theta = flipAngle(flip)
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    const hx = imgW / 2
    const hy = imgH / 2

    let a = cos * hx
    let b = sin * hx
    let c = -sin * hy
    let d = cos * hy
    let e = 0
    let f = 0

    a *= scale
    b *= scale
    c *= scale
    d *= scale
    e = view.fit ? 0 : view.pan.x
    f = view.fit ? 0 : view.pan.y

    const ox = 2 / m.cw
    const oy = 2 / m.ch
    return new Float32Array([a * ox, b * oy, 0, c * ox, d * oy, 0, e * ox, f * oy, 1])
}

export const zoomAboutCursor = (view: ViewState, m: Metrics, cursor: Point, factor: number) => {
    const baseZoom = view.fit ? m.fitScale / m.dpr : view.zoom
    const zoom = clamp(baseZoom * factor, MIN_ZOOM, MAX_ZOOM)
    const scaleOld = viewScale(view, m)
    const scaleNew = zoom * m.dpr
    const panOld = view.fit ? { x: 0, y: 0 } : view.pan
    const ratio = scaleNew / scaleOld
    const pan = { x: cursor.x - ratio * (cursor.x - panOld.x), y: cursor.y - ratio * (cursor.y - panOld.y) }
    const next: ViewState = { fit: false, zoom, pan }
    return { fit: false, zoom, pan: clampPan(pan, next, m) }
}

export const toggleFit = (view: ViewState, m: Metrics, cursor: Point) => {
    if (!view.fit) return { fit: true, zoom: view.zoom, pan: { x: 0, y: 0 } }
    const ratio = m.dpr / m.fitScale
    const pan = { x: cursor.x - ratio * cursor.x, y: cursor.y - ratio * cursor.y }
    const next: ViewState = { fit: false, zoom: 1, pan }
    return { fit: false, zoom: 1, pan: clampPan(pan, next, m) }
}

export const zoomTo = (zoom: number) => ({ fit: false, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM), pan: { x: 0, y: 0 } })
