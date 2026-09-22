import { EDITOR_NUDGE_LARGE_PX, EDITOR_NUDGE_PX, EDITOR_PERCENT, EDITOR_SIZE, EDITOR_TOOLS } from '../shared/constants/editor'
import { activeDrawerLayerId, DEFAULT_DRAWER_TRANSFORM, duplicateDrawerLayer, removeDrawerLayer, setDrawerLayerTransform } from '../store/drawer'
import { useEditStore } from '../store/editStore'
import { usePlaylist } from '../store/playlist'
import { useUiStore } from '../store/uiStore'

const ARROW_DELTAS: Record<string, readonly [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

export const handleEditorShortcut = (event: KeyboardEvent) => {
    const ui = useUiStore.getState()
    if (ui.workspace !== 'editor') return false
    const entry = usePlaylist.getState().entries[usePlaylist.getState().currentIndex]
    const level = entry ? usePlaylist.getState().best[entry.imageId] : undefined
    const ready =
        entry &&
        !entry.isAnimated &&
        !ui.gpuError &&
        level &&
        level.level !== 'l0' &&
        useEditStore.getState().imageId === entry.imageId &&
        useEditStore.getState().state !== null
    const command = event.metaKey || event.ctrlKey
    if (command && event.code === 'KeyD') {
        if (ready) ui.setDrawerSelection(null)
        return true
    }
    if (command && !event.altKey && event.code === 'KeyJ') {
        const id = activeDrawerLayerId()
        if (ready && id) duplicateDrawerLayer(id)
        return true
    }
    if (command || event.altKey) return false
    if (event.code === 'Delete' || event.code === 'Backspace') {
        const id = activeDrawerLayerId()
        if (ready && id && !event.repeat) removeDrawerLayer(id)
        return true
    }
    const item = EDITOR_TOOLS.find((candidate) => `Key${candidate.key}` === event.code)
    if (item) {
        if (ready) ui.setDrawerTool(item.id)
        return true
    }
    if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        const delta = event.code === 'BracketRight' ? EDITOR_SIZE.keyboardStep : -EDITOR_SIZE.keyboardStep
        ui.setDrawerSize(Math.min(EDITOR_SIZE.max, Math.max(EDITOR_SIZE.min, ui.drawerSize + delta)))
        return true
    }
    const direction = ARROW_DELTAS[event.code]
    if (!direction) return false
    const id = activeDrawerLayerId()
    const layer = useEditStore.getState().state?.drawer?.layers.find((item) => item.id === id)
    if (!ready || !level || !layer || ui.drawerTool !== 'move') return true
    const transform = layer.transform ?? DEFAULT_DRAWER_TRANSFORM
    const step = event.shiftKey ? EDITOR_NUDGE_LARGE_PX : EDITOR_NUDGE_PX
    setDrawerLayerTransform(layer.id, {
        offsetX: transform.offsetX + (direction[0] * step * EDITOR_PERCENT) / level.width,
        offsetY: transform.offsetY + (direction[1] * step * EDITOR_PERCENT) / level.height,
    })
    return true
}
