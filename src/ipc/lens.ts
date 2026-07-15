import { invoke } from '@tauri-apps/api/core'
import type { LensProfileMatch } from '../types/LensProfileMatch'
import type { LensProfileSummary } from '../types/LensProfileSummary'

export const findLensProfile = (imageId: string) => invoke<LensProfileMatch | null>('find_lens_profile', { imageId })

export const listLensProfiles = (query: string) => invoke<LensProfileSummary[]>('list_lens_profiles', { query })

export const setLensOverride = (lensKey: string, profileId: string) => invoke<void>('set_lens_override', { lensKey, profileId })
