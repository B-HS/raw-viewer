import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { DngExportResult } from '../types/DngExportResult'
import type { ExportProgressPayload } from '../types/ExportProgressPayload'
import type { RasterExportRequest } from '../types/RasterExportRequest'

export type ExportTilePayload = { x: number; y: number; width: number; height: number; data: Uint16Array }

export const exportBegin = (request: RasterExportRequest) => invoke<string>('export_begin', { request })

export const exportTile = (jobId: string, tile: ExportTilePayload) =>
    invoke<void>('export_tile', new Uint8Array(tile.data.buffer, tile.data.byteOffset, tile.data.byteLength), {
        headers: {
            'x-export-job': jobId,
            'x-tile-x': String(tile.x),
            'x-tile-y': String(tile.y),
            'x-tile-w': String(tile.width),
            'x-tile-h': String(tile.height),
        },
    })

export const exportSetWatermark = (jobId: string, png: Uint8Array) =>
    invoke<void>('export_set_watermark', png, { headers: { 'x-export-job': jobId } })

export const readWatermarkPng = (path: string) => invoke<ArrayBuffer>('read_watermark_png', { path })

export const exportFinish = (jobId: string) => invoke<string>('export_finish', { jobId })

export const exportCancel = (jobId: string) => invoke<void>('export_cancel', { jobId })

export const exportDng = (imageId: string, outDir: string) => invoke<DngExportResult>('export_dng', { imageId, outDir })

export const onExportProgress = (handler: (payload: ExportProgressPayload) => void) =>
    listen<ExportProgressPayload>('export:progress', (event) => handler(event.payload))
