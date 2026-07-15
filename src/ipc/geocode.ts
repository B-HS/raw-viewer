import { invoke } from '@tauri-apps/api/core'

export const getReverseGeocode = (imageId: string) => invoke<string | null>('get_reverse_geocode', { imageId })
