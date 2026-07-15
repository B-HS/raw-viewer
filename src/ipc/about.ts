import { invoke } from '@tauri-apps/api/core'
import type { CacheKind } from '../types/CacheKind'
import type { CacheStats } from '../types/CacheStats'

export const getLicenses = () => invoke<string>('get_licenses')

export const getCacheStats = () => invoke<CacheStats>('get_cache_stats')

export const clearCache = (kind: CacheKind) => invoke<void>('clear_cache', { kind })

export const detectExiftool = () => invoke<string | null>('detect_exiftool')

export const getDeepMetadata = (imageId: string) => invoke<Record<string, string | number> | null>('get_deep_metadata', { imageId })
