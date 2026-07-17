import { dispDims } from '../gl/viewTransform'
import { i18n } from '../i18n/i18n'
import { useEditStore } from './editStore'
import { usePlaylist } from './playlist'
import { useUiStore } from './uiStore'
import type { CropState } from '../types/CropState'

export const CROP_ASPECTS = ['original', 'free', '1:1', '4:3', '3:2', '16:9', '5:4']

export type Rect = { left: number; top: number; right: number; bottom: number }

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

export const isFullFrame = (crop: CropState) => crop.left <= 0.001 && crop.top <= 0.001 && crop.right >= 0.999 && crop.bottom >= 0.999

export const currentImageFlip = () => {
    const playlist = usePlaylist.getState()
    const current = playlist.entries[playlist.currentIndex]
    const best = current ? playlist.best[current.imageId] : undefined
    return best ? best.flip : 0
}

const currentDisplayDims = () => {
    const playlist = usePlaylist.getState()
    const current = playlist.entries[playlist.currentIndex]
    const best = current ? playlist.best[current.imageId] : undefined
    if (!best) return { dispW: 1, dispH: 1 }
    return dispDims(best.width, best.height, best.flip)
}

export const cropDisplayRatio = (aspect: string) => {
    if (aspect === 'free') return null
    if (aspect === 'original') {
        const { dispW, dispH } = currentDisplayDims()
        return dispH > 0 ? dispW / dispH : 1
    }
    const parts = aspect.split(':').map(Number)
    return parts.length === 2 && parts[0] > 0 && parts[1] > 0 ? parts[0] / parts[1] : null
}

export const cropNormRatio = (aspect: string) => {
    const ratio = cropDisplayRatio(aspect)
    if (ratio === null) return null
    const { dispW, dispH } = currentDisplayDims()
    const displayAspect = dispH > 0 ? dispW / dispH : 1
    return displayAspect > 0 ? ratio / displayAspect : ratio
}

export const sourceToDisplay = (rect: Rect, flip: number) => {
    if (flip === 3) return { left: 1 - rect.right, top: 1 - rect.bottom, right: 1 - rect.left, bottom: 1 - rect.top }
    if (flip === 6) return { left: 1 - rect.bottom, top: rect.left, right: 1 - rect.top, bottom: rect.right }
    if (flip === 5) return { left: rect.top, top: 1 - rect.right, right: rect.bottom, bottom: 1 - rect.left }
    return { ...rect }
}

export const displayToSource = (rect: Rect, flip: number) => {
    if (flip === 3) return { left: 1 - rect.right, top: 1 - rect.bottom, right: 1 - rect.left, bottom: 1 - rect.top }
    if (flip === 6) return { left: rect.top, top: 1 - rect.right, right: rect.bottom, bottom: 1 - rect.left }
    if (flip === 5) return { left: 1 - rect.bottom, top: rect.left, right: 1 - rect.top, bottom: rect.right }
    return { ...rect }
}

export const fitRectToRatio = (center: { x: number; y: number }, normRatio: number) => {
    const maxW = Math.min(center.x, 1 - center.x) * 2
    const maxH = Math.min(center.y, 1 - center.y) * 2
    let width = Math.min(maxW, maxH * normRatio)
    let height = width / normRatio
    if (height > maxH) {
        height = maxH
        width = height * normRatio
    }
    return { left: center.x - width / 2, top: center.y - height / 2, right: center.x + width / 2, bottom: center.y + height / 2 }
}

const writeCrop = (next: CropState, label: string, discrete: boolean) =>
    useEditStore.getState().edit((draft) => void (draft.crop = next), discrete ? { label } : { coalesceKey: 'crop.rect', label })

export const setCropRect = (rect: Rect, aspect: string) => {
    const state = useEditStore.getState().state
    if (!state) return
    writeCrop(
        {
            enabled: true,
            aspect,
            left: clamp01(rect.left),
            top: clamp01(rect.top),
            right: clamp01(rect.right),
            bottom: clamp01(rect.bottom),
        },
        i18n.t('history.cropAdjust'),
        false,
    )
}

export const applyCropAspect = (aspect: string) => {
    const state = useEditStore.getState().state
    if (!state) return
    const crop = state.crop ?? { enabled: true, left: 0, top: 0, right: 1, bottom: 1, aspect }
    const normRatio = cropNormRatio(aspect)
    if (normRatio === null) {
        writeCrop({ ...crop, enabled: true, aspect }, i18n.t('history.cropRatio'), true)
        return
    }
    const center = { x: (crop.left + crop.right) / 2, y: (crop.top + crop.bottom) / 2 }
    const fitted = fitRectToRatio(center, normRatio)
    writeCrop({ enabled: true, aspect, ...fitted }, i18n.t('history.cropRatio'), true)
}

export const swapCropAspect = () => {
    const state = useEditStore.getState().state
    if (!state) return
    const aspect = state.crop?.aspect ?? 'original'
    if (!aspect.includes(':')) return
    const parts = aspect.split(':')
    applyCropAspect(`${parts[1]}:${parts[0]}`)
}

export const toggleCropMode = () => {
    const ui = useUiStore.getState()
    const editStore = useEditStore.getState()
    if (!editStore.state) return
    if (ui.cropEditMode) {
        const crop = editStore.state.crop
        if (crop && crop.enabled && isFullFrame(crop)) editStore.edit((draft) => void (draft.crop = null), { label: i18n.t('history.cropRelease') })
        ui.setCropEditMode(false)
        return
    }
    const crop = editStore.state.crop
    if (!crop || !crop.enabled)
        editStore.edit((draft) => void (draft.crop = { enabled: true, left: 0, top: 0, right: 1, bottom: 1, aspect: crop?.aspect ?? 'original' }), {
            label: i18n.t('history.crop'),
        })
    ui.setCropEditMode(true)
}
