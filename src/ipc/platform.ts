import { invoke } from '@tauri-apps/api/core'
import type { PairInfo } from '../types/PairInfo'
import type { RecentEntry } from '../types/RecentEntry'

export const copyImageToClipboard = (png: Uint8Array) => invoke<void>('copy_image_to_clipboard', png)

export const copyFilesToClipboard = (imageIds: string[]) => invoke<void>('copy_files_to_clipboard', { imageIds })

export const copyText = (text: string) => invoke<void>('copy_text', { text })

export const getPairs = (dir: string) => invoke<PairInfo[]>('get_pairs', { dir })

export const noteRecent = (path: string) => invoke<void>('note_recent', { path })

export const getRecents = () => invoke<RecentEntry[]>('get_recents')

export const clearRecents = () => invoke<void>('clear_recents')

export const getDisplayColorSpace = () => invoke<'display-p3' | 'srgb'>('get_display_color_space')

export const revealInFileManager = (imageId: string) => invoke<void>('reveal_in_file_manager', { imageId })

export const openWithExternal = (imageId: string, appPath: string) => invoke<void>('open_with_external', { imageId, appPath })

export const openWithEdited = (path: string, appPath: string) => invoke<void>('open_with_edited', { path, appPath })
