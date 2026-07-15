import { invoke } from '@tauri-apps/api/core'
import type { L2Policy } from '../types/L2Policy'

export const setPerformanceSettings = (preloadRadius: number, l2Policy: L2Policy, isolatedDecode: boolean) =>
    invoke<void>('set_performance_settings', { preloadRadius, l2Policy, isolatedDecode })

export const requestL2 = (imageId: string) => invoke<void>('request_l2', { imageId })
