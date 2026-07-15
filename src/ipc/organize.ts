import { invoke } from '@tauri-apps/api/core'
import type { Flag } from '../types/Flag'
import type { OrganizeEntry } from '../types/OrganizeEntry'

export const getOrganize = (imageIds: string[]) => invoke<OrganizeEntry[]>('get_organize', { imageIds })

export const setRating = (imageIds: string[], rating: number) => invoke<void>('set_rating', { imageIds, rating })

export const setFlag = (imageIds: string[], flag: Flag | null) => invoke<void>('set_flag', { imageIds, flag })

export const setLabel = (imageIds: string[], label: string | null) => invoke<void>('set_label', { imageIds, label })

export const flushOrganize = () => invoke<void>('flush_organize')
