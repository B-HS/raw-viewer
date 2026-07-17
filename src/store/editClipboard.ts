import { create } from 'zustand'
import { i18n } from '../i18n/i18n'
import { useEditStore } from './editStore'
import { usePlaylist } from './playlist'
import { PRESET_SECTIONS } from './presetStore'
import { useToast } from './toast'
import { copySettings } from '../ipc/preset'

const ALL_MASK = [...PRESET_SECTIONS]

const currentImageId = () => {
    const state = usePlaylist.getState()
    return state.entries[state.currentIndex]?.imageId ?? null
}

type EditClipboardState = {
    sourceImageId: string | null
    copy: () => void
    pasteTo: (targets: string[]) => Promise<void>
    pastePrevious: () => Promise<void>
    syncSelection: (targets: string[]) => Promise<void>
}

export const useEditClipboard = create<EditClipboardState>((set, get) => ({
    sourceImageId: null,
    copy: () => {
        const imageId = currentImageId()
        if (!imageId) return
        set({ sourceImageId: imageId })
        useToast.getState().show(i18n.t('toast.editCopied'))
    },
    pasteTo: async (targets) => {
        const source = get().sourceImageId
        if (!source || targets.length === 0) return
        const current = currentImageId()
        try {
            await useEditStore.getState().flushPending()
            await copySettings(source, targets, ALL_MASK)
            if (current && targets.includes(current)) await useEditStore.getState().applyServerState(i18n.t('history.pasteEdit'))
            useToast.getState().show(targets.length > 1 ? i18n.t('toast.editPastedCount', { count: targets.length }) : i18n.t('toast.editPasted'))
        } catch {
            useToast.getState().show(i18n.t('toast.pasteFailed'))
        }
    },
    pastePrevious: async () => {
        const state = usePlaylist.getState()
        const current = state.entries[state.currentIndex]
        const previous = state.entries[state.currentIndex - 1]
        if (!current || !previous) return
        try {
            await useEditStore.getState().flushPending()
            await copySettings(previous.imageId, [current.imageId], ALL_MASK)
            await useEditStore.getState().applyServerState(i18n.t('history.pastePrevious'))
            useToast.getState().show(i18n.t('toast.prevApplied'))
        } catch {
            useToast.getState().show(i18n.t('toast.pasteFailed'))
        }
    },
    syncSelection: async (targets) => {
        const current = currentImageId()
        if (!current || targets.length === 0) return
        try {
            await useEditStore.getState().flushPending()
            await copySettings(current, targets, ALL_MASK)
            useToast.getState().show(i18n.t('toast.syncedCount', { count: targets.length }))
        } catch {
            useToast.getState().show(i18n.t('toast.syncFailed'))
        }
    },
}))
