import { invoke } from '@tauri-apps/api/core'

export type DisplayLut = { size: number; data: Float32Array }

export const hasDisplayIccProfile = () => invoke<boolean>('has_display_icc_profile')

export const getDisplayLut = async () => {
    const buffer = await invoke<ArrayBuffer>('get_display_lut')
    if (buffer.byteLength < 4) return null
    const size = new DataView(buffer).getUint32(0, true)
    if (size < 2) return null
    return { size, data: new Float32Array(buffer, 4, size * size * size * 3) }
}
