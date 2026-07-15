import { invoke } from '@tauri-apps/api/core'

export const watchDirectory = (dir: string) => invoke<void>('watch_directory', { dir })

export const moveToTrash = (imageIds: string[]) => invoke<string[]>('move_to_trash', { imageIds })
