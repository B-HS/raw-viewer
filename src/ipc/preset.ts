import { invoke } from '@tauri-apps/api/core'
import type { PresetInfo } from '../types/PresetInfo'

export const listPresets = () => invoke<PresetInfo[]>('list_presets')

export const savePreset = (name: string, folder: string, imageId: string, mask: string[]) =>
    invoke<PresetInfo>('save_preset', { name, folder, imageId, mask })

export const applyPreset = (presetId: string, targets: string[]) => invoke<void>('apply_preset', { presetId, targets })

export const deletePreset = (presetId: string) => invoke<void>('delete_preset', { presetId })

export const copySettings = (from: string, to: string[], mask: string[]) => invoke<void>('copy_settings', { from, to, mask })
