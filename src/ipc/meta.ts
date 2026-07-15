import { invoke } from '@tauri-apps/api/core'
import type { ImageMetadata } from '../types/ImageMetadata'

export const getMetadata = (imageId: string) => invoke<ImageMetadata>('get_metadata', { imageId })
