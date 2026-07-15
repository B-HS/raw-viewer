import { Channel, invoke } from '@tauri-apps/api/core'
import type { CpuFrameReadyPayload } from '../types/CpuFrameReadyPayload'
import type { EditState } from '../types/EditState'
import type { EditStateEnvelope } from '../types/EditStateEnvelope'
import type { OpenResult } from '../types/OpenResult'
import type { PendingOpenRequest } from '../types/PendingOpenRequest'
import type { ScanBatch } from '../types/ScanBatch'
import type { ScanSummary } from '../types/ScanSummary'

export const openPath = (path: string) => invoke<OpenResult>('open_path', { path })

export const openInNewWindow = (path: string) => invoke<string>('open_in_new_window', { path })

export const scanDirectory = (dir: string, onBatch: (batch: ScanBatch) => void) => {
    const channel = new Channel<ScanBatch>()
    channel.onmessage = onBatch
    return invoke<ScanSummary>('scan_directory', { dir, onBatch: channel })
}

export const navigate = (imageId: string, prevIds: string[], nextIds: string[]) => invoke<void>('navigate', { imageId, prevIds, nextIds })

export const frontendReady = () => invoke<PendingOpenRequest[]>('frontend_ready')

export const getEditState = (imageId: string) => invoke<EditStateEnvelope>('get_edit_state', { imageId })

export const setEditStateCommand = (imageId: string, state: EditState, editVersion: number) =>
    invoke<number>('set_edit_state', { imageId, state, editVersion })

export const resetEditState = (imageId: string) => invoke<EditStateEnvelope>('reset_edit_state', { imageId })

export const flushEdits = () => invoke<void>('flush_edits')

export const renderCpuFrame = (imageId: string, maxEdge: number) => invoke<CpuFrameReadyPayload>('render_cpu_frame', { imageId, maxEdge })

export const isConflictError = (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'conflict'
