import { i18n } from '../i18n/i18n'
import { useEditStore } from './editStore'
import { useUiStore } from './uiStore'
import type { DrawerAdjust } from '../types/DrawerAdjust'
import type { DrawerBlendMode } from '../types/DrawerBlendMode'
import type { DrawerLayer } from '../types/DrawerLayer'
import type { DrawerObject } from '../types/DrawerObject'
import type { DrawerTransform } from '../types/DrawerTransform'

export const DEFAULT_DRAWER_TRANSFORM: DrawerTransform = { offsetX: 0, offsetY: 0, scale: 100, rotate: 0 }

export const DEFAULT_DRAWER_ADJUST: DrawerAdjust = { brightness: 0, contrast: 0, saturation: 0, hue: 0 }

const createLayer = (index: number): DrawerLayer => ({
    id: crypto.randomUUID(),
    name: i18n.t('panel.drawer.layerName', { index }),
    visible: true,
    opacity: 100,
    objects: [],
    blend: 'normal',
    transform: null,
    adjust: null,
})

export const activeDrawerLayerId = () => {
    const layers = useEditStore.getState().state?.drawer?.layers ?? []
    const preferred = useUiStore.getState().drawerActiveLayerId
    if (preferred !== null && layers.some((layer) => layer.id === preferred)) return preferred
    return layers.at(-1)?.id ?? null
}

export const ensureDrawerLayer = () => {
    if (!useEditStore.getState().state) return null
    const existing = activeDrawerLayerId()
    if (existing !== null) return existing
    return addDrawerLayer()
}

export const addDrawerLayer = () => {
    const editStore = useEditStore.getState()
    if (!editStore.state) return null
    const layer = createLayer((editStore.state.drawer?.layers.length ?? 0) + 1)
    editStore.edit(
        (draft) => {
            if (!draft.drawer) draft.drawer = { layers: [] }
            draft.drawer.layers.push(layer)
        },
        { label: i18n.t('history.drawerLayerAdd') },
    )
    useUiStore.getState().setDrawerActiveLayer(layer.id)
    return layer.id
}

export const removeDrawerLayer = (id: string) => {
    const editStore = useEditStore.getState()
    if (!editStore.state?.drawer) return
    editStore.edit(
        (draft) => {
            if (!draft.drawer) return
            const layers = draft.drawer.layers.filter((layer) => layer.id !== id)
            draft.drawer = layers.length > 0 ? { layers } : null
        },
        { label: i18n.t('history.drawerLayerRemove') },
    )
    if (useUiStore.getState().drawerActiveLayerId === id) useUiStore.getState().setDrawerActiveLayer(null)
}

export const moveDrawerLayer = (id: string, delta: number) =>
    useEditStore.getState().edit(
        (draft) => {
            const layers = draft.drawer?.layers
            if (!layers) return
            const index = layers.findIndex((layer) => layer.id === id)
            const target = index + delta
            if (index < 0 || target < 0 || target >= layers.length) return
            const [layer] = layers.splice(index, 1)
            layers.splice(target, 0, layer)
        },
        { label: i18n.t('history.drawerLayerMove') },
    )

export const setDrawerLayerVisible = (id: string, on: boolean) =>
    useEditStore.getState().edit(
        (draft) => {
            const layer = draft.drawer?.layers.find((item) => item.id === id)
            if (layer) layer.visible = on
        },
        { label: i18n.t('history.drawerLayerVisible') },
    )

export const setDrawerLayerOpacity = (id: string, opacity: number) =>
    useEditStore.getState().edit(
        (draft) => {
            const layer = draft.drawer?.layers.find((item) => item.id === id)
            if (layer) layer.opacity = opacity
        },
        { coalesceKey: `drawer.opacity.${id}`, label: i18n.t('history.drawerLayerOpacity') },
    )

export const setDrawerLayerBlend = (id: string, blend: DrawerBlendMode) =>
    useEditStore.getState().edit(
        (draft) => {
            const layer = draft.drawer?.layers.find((item) => item.id === id)
            if (layer) layer.blend = blend
        },
        { label: i18n.t('history.drawerLayerBlend') },
    )

export const setDrawerLayerTransform = (id: string, patch: Partial<DrawerTransform>) =>
    useEditStore.getState().edit(
        (draft) => {
            const layer = draft.drawer?.layers.find((item) => item.id === id)
            if (layer) layer.transform = { ...(layer.transform ?? DEFAULT_DRAWER_TRANSFORM), ...patch }
        },
        { coalesceKey: `drawer.transform.${id}`, label: i18n.t('history.drawerLayerTransform') },
    )

export const setDrawerLayerAdjust = (id: string, patch: Partial<DrawerAdjust>) =>
    useEditStore.getState().edit(
        (draft) => {
            const layer = draft.drawer?.layers.find((item) => item.id === id)
            if (layer) layer.adjust = { ...(layer.adjust ?? DEFAULT_DRAWER_ADJUST), ...patch }
        },
        { coalesceKey: `drawer.adjust.${id}`, label: i18n.t('history.drawerLayerAdjust') },
    )

const OBJECT_HISTORY_KEY: Record<DrawerObject['kind'], string> = {
    stroke: 'history.drawerDraw',
    shape: 'history.drawerDraw',
    text: 'history.drawerText',
    fill: 'history.drawerFill',
    clone: 'history.drawerDraw',
    blur: 'history.drawerDraw',
}

export const appendDrawerObject = (layerId: string, object: DrawerObject) =>
    useEditStore.getState().edit(
        (draft) => {
            const layer = draft.drawer?.layers.find((item) => item.id === layerId)
            if (layer) layer.objects.push(object)
        },
        { coalesceKey: 'drawer.draw', label: i18n.t(OBJECT_HISTORY_KEY[object.kind]) },
    )

export const mutateLastDrawerObject = (layerId: string, mutate: (object: DrawerObject) => void) =>
    useEditStore.getState().edit(
        (draft) => {
            const layer = draft.drawer?.layers.find((item) => item.id === layerId)
            const object = layer?.objects.at(-1)
            if (object) mutate(object)
        },
        { coalesceKey: 'drawer.draw', label: i18n.t('history.drawerDraw') },
    )
