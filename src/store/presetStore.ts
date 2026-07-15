import { create } from 'zustand'
import { i18n } from '../i18n'
import { useEditStore } from './editStore'
import { usePlaylist } from './playlist'
import { useToast } from './toast'
import { applyPreset, deletePreset, listPresets, savePreset } from '../ipc/preset'
import type { PresetInfo } from '../types/PresetInfo'

export const PRESET_SECTIONS = ['wb', 'lens', 'geometry', 'tone', 'curves', 'color', 'detail', 'effects'] as const

export type PresetSectionKey = (typeof PRESET_SECTIONS)[number]

const currentImageId = () => {
    const state = usePlaylist.getState()
    return state.entries[state.currentIndex]?.imageId ?? null
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

type PresetStoreState = {
    presets: PresetInfo[]
    loaded: boolean
    loading: boolean
    load: () => Promise<void>
    applyToCurrent: (presetId: string, name: string) => Promise<void>
    save: (name: string, folder: string, mask: string[]) => Promise<boolean>
    remove: (presetId: string) => Promise<void>
}

export const usePresetStore = create<PresetStoreState>((set, get) => ({
    presets: [],
    loaded: false,
    loading: false,
    load: async () => {
        set({ loading: true })
        try {
            const presets = await listPresets()
            set({ presets, loaded: true, loading: false })
        } catch {
            set({ loading: false })
        }
    },
    applyToCurrent: async (presetId, name) => {
        const imageId = currentImageId()
        if (!imageId) return
        try {
            await useEditStore.getState().flushPending()
            await applyPreset(presetId, [imageId])
            await useEditStore.getState().applyServerState(i18n.t('history.applyPreset', { name }))
            useToast.getState().show(i18n.t('toast.presetApplied', { name }))
        } catch (error) {
            useToast.getState().show(i18n.t('toast.presetApplyFailed', { message: errorMessage(error) }))
        }
    },
    save: async (name, folder, mask) => {
        const imageId = currentImageId()
        if (!imageId || mask.length === 0) return false
        try {
            await useEditStore.getState().flushPending()
            await savePreset(name, folder, imageId, mask)
            await get().load()
            useToast.getState().show(i18n.t('toast.presetSaved'))
            return true
        } catch (error) {
            useToast.getState().show(i18n.t('toast.presetSaveFailed', { message: errorMessage(error) }))
            return false
        }
    },
    remove: async (presetId) => {
        try {
            await deletePreset(presetId)
            await get().load()
            useToast.getState().show(i18n.t('toast.presetDeleted'))
        } catch (error) {
            useToast.getState().show(i18n.t('toast.presetDeleteFailed', { message: errorMessage(error) }))
        }
    },
}))
