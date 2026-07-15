import { create } from 'zustand'
import { i18n } from '../i18n'
import { useToast } from './toast'
import { useLens } from './lens'
import { LEVEL_RANK, usePlaylist } from './playlist'
import { useEditStore } from './editStore'
import { getEditState, navigate } from '../ipc/commands'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { exportBegin, exportCancel, exportDng, exportFinish, exportSetWatermark, exportTile } from '../ipc/export'
import { openWithEdited } from '../ipc/platform'
import { onLevelReady } from '../ipc/events'
import { fetchPixels } from '../ipc/pixels'
import { createExportEngine } from '../gl/exportRenderer'
import { loadWatermarkImage, renderWatermarkPng } from '../lib/watermark'
import type { WatermarkSettings } from '../lib/watermark'
import type { ExportEngine, ExportSource } from '../gl/exportRenderer'
import type { ConflictPolicy } from '../types/ConflictPolicy'
import type { ExportColorSpace } from '../types/ExportColorSpace'
import type { ExportMetadata } from '../types/ExportMetadata'
import type { ImageEntry } from '../types/ImageEntry'
import type { LevelReadyPayload } from '../types/LevelReadyPayload'
import type { RasterExportRequest } from '../types/RasterExportRequest'
import type { RasterFormat } from '../types/RasterFormat'
import type { ResizeMode } from '../types/ResizeMode'

export type ExportOutputMode = 'source' | 'exported' | 'custom'

export type ExportSettings = {
    format: RasterFormat
    quality: number
    colorSpace: ExportColorSpace
    bits: number
    resizeMode: ResizeMode
    resizeValue: number
    metadata: ExportMetadata
    filenameTemplate: string
    output: ExportOutputMode
    customDir: string
    conflict: ConflictPolicy
    watermark: WatermarkSettings
}

const SETTINGS_KEY = 'raw-viewer:export-settings'
const GPS_NOTICE_KEY = 'raw-viewer:export-gps-notice'
const LEVEL_TIMEOUT_MS = 12000

const DEFAULT_WATERMARK: WatermarkSettings = {
    enabled: false,
    mode: 'text',
    text: '©',
    sizePercent: 5,
    opacity: 80,
    position: 'bottom-right',
    marginPercent: 3,
    imagePath: '',
}

const DEFAULT_SETTINGS: ExportSettings = {
    format: 'jpeg',
    quality: 90,
    colorSpace: 'srgb',
    bits: 8,
    resizeMode: 'none',
    resizeValue: 2048,
    metadata: 'all',
    filenameTemplate: '{name}',
    output: 'source',
    customDir: '',
    conflict: 'rename',
    watermark: DEFAULT_WATERMARK,
}

const loadSettings = () => {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY)
        if (!raw) return DEFAULT_SETTINGS
        const parsed = JSON.parse(raw) as Partial<ExportSettings>
        return { ...DEFAULT_SETTINGS, ...parsed, watermark: { ...DEFAULT_WATERMARK, ...(parsed.watermark ?? {}) } }
    } catch {
        return DEFAULT_SETTINGS
    }
}

const outputDims = (settings: ExportSettings, width: number, height: number): [number, number] => {
    if (width < 1 || height < 1) return [Math.max(1, width), Math.max(1, height)]
    if (settings.resizeMode === 'long-edge') {
        if (settings.resizeValue < 1) return [width, height]
        const scale = Math.min(settings.resizeValue / Math.max(width, height), 1)
        return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
    }
    if (settings.resizeMode === 'percent') {
        const scale = settings.resizeValue / 100
        if (scale <= 0) return [width, height]
        return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
    }
    return [width, height]
}

const persistSettings = (settings: ExportSettings) => {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {}
}

const gpsNoticeShown = () => {
    try {
        return localStorage.getItem(GPS_NOTICE_KEY) === '1'
    } catch {
        return true
    }
}

const dirname = (path: string) => {
    const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    return index > 0 ? path.slice(0, index) : path
}

const resolveOutputDir = (settings: ExportSettings, entry: ImageEntry | undefined) => {
    if (settings.output === 'custom') return settings.customDir
    const base = entry ? dirname(entry.path) : ''
    return settings.output === 'exported' ? `${base}/Exported` : base
}

const effectiveBits = (settings: ExportSettings) => (settings.format === 'png' || settings.format === 'tiff' ? settings.bits : 8)

const buildRequest = (
    settings: ExportSettings,
    imageId: string,
    sourceWidth: number,
    sourceHeight: number,
    seq: number,
    outputDir: string,
    presetName: string | null,
): RasterExportRequest => ({
    imageId,
    format: settings.format,
    quality: settings.quality,
    colorSpace: settings.colorSpace,
    bits: effectiveBits(settings),
    resize: { mode: settings.resizeMode, value: settings.resizeValue },
    sharpen: 'none',
    metadata: settings.metadata,
    filenameTemplate: settings.filenameTemplate,
    outputDir,
    conflict: settings.conflict,
    sourceWidth,
    sourceHeight,
    seq,
    presetName,
})

const waitForLevel = (imageId: string, timeoutMs: number) =>
    new Promise<LevelReadyPayload | null>((resolve) => {
        let best: LevelReadyPayload | null = null
        let settled = false
        let unlisten: (() => void) | null = null
        let timer: ReturnType<typeof setTimeout> | null = null
        const finish = (payload: LevelReadyPayload | null) => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            if (unlisten) unlisten()
            resolve(payload)
        }
        onLevelReady((payload) => {
            if (payload.imageId !== imageId) return
            if (payload.level === 'l2') {
                finish(payload)
                return
            }
            if (payload.level === 'l1' && (!best || LEVEL_RANK[best.level] < LEVEL_RANK[payload.level])) best = payload
        }).then((fn) => {
            if (settled) {
                fn()
                return
            }
            unlisten = fn
            const now = usePlaylist.getState().best[imageId]
            if (now && now.level === 'l2') {
                finish(now)
                return
            }
            if (now && now.level === 'l1') best = now
            timer = setTimeout(() => finish(best), timeoutMs)
            navigate(imageId, [], []).catch(() => undefined)
        })
    })

export const ensureAethSource = async (imageId: string) => {
    const best = usePlaylist.getState().best[imageId]
    let chosen: LevelReadyPayload | null = best && best.level === 'l2' ? best : null
    if (!chosen) chosen = await waitForLevel(imageId, LEVEL_TIMEOUT_MS)
    if (!chosen || chosen.level === 'l0') return null
    const controller = new AbortController()
    const pixels = await fetchPixels(imageId, chosen.level, chosen.rev, controller.signal)
    if (pixels.kind !== 'aeth') return null
    const source: ExportSource = { width: pixels.width, height: pixels.height, data: pixels.data, colorMatrix: chosen.colorMatrix, flip: chosen.flip }
    return { source, level: chosen.level }
}

type ExportFailure = { imageId: string; name: string; message: string }

type DngPrompt = { imageId: string; name: string; message: string }

type ExportStoreState = {
    open: boolean
    targets: string[]
    settings: ExportSettings
    running: boolean
    done: number
    total: number
    currentName: string
    warning: string | null
    failures: ExportFailure[]
    lastOutputPath: string | null
    finished: boolean
    cancelRequested: boolean
    gpsNoticeNeeded: boolean
    dngPrompt: DngPrompt | null
    openDialog: (targets: string[]) => void
    close: () => void
    update: (patch: Partial<ExportSettings>) => void
    acknowledgeGps: () => void
    start: () => Promise<void>
    retryFailed: () => void
    cancel: () => void
    runDng: (imageId: string, name: string, entry: ImageEntry | undefined) => Promise<void>
    runEditedHandoff: (imageId: string, name: string, entry: ImageEntry | undefined, appPath: string) => Promise<void>
    dismissDng: () => void
    dngToTiff: () => void
}

export const useExportStore = create<ExportStoreState>((set, get) => ({
    open: false,
    targets: [],
    settings: loadSettings(),
    running: false,
    done: 0,
    total: 0,
    currentName: '',
    warning: null,
    failures: [],
    lastOutputPath: null,
    finished: false,
    cancelRequested: false,
    gpsNoticeNeeded: false,
    dngPrompt: null,
    openDialog: (targets) =>
        set({
            open: true,
            targets,
            running: false,
            done: 0,
            total: targets.length,
            currentName: '',
            warning: null,
            failures: [],
            lastOutputPath: null,
            finished: false,
            cancelRequested: false,
            gpsNoticeNeeded: !gpsNoticeShown(),
        }),
    close: () => set({ open: false }),
    update: (patch) =>
        set((state) => {
            const settings = { ...state.settings, ...patch }
            persistSettings(settings)
            return { settings }
        }),
    acknowledgeGps: () => {
        try {
            localStorage.setItem(GPS_NOTICE_KEY, '1')
        } catch {}
        set({ gpsNoticeNeeded: false })
    },
    cancel: () => set({ cancelRequested: true }),
    start: async () => {
        if (get().running) return
        const targets = get().targets
        if (targets.length === 0) return
        set({
            running: true,
            done: 0,
            total: targets.length,
            failures: [],
            warning: null,
            lastOutputPath: null,
            finished: false,
            cancelRequested: false,
        })
        let engine: ExportEngine
        try {
            engine = createExportEngine()
        } catch {
            set({ running: false, warning: i18n.t('export.warnGpu') })
            return
        }
        try {
            await useEditStore.getState().flushPending()
            for (let index = 0; index < targets.length; index++) {
                if (get().cancelRequested) break
                const imageId = targets[index]
                const entry = usePlaylist.getState().entries.find((item) => item.imageId === imageId)
                const name = entry?.fileName ?? imageId
                set({ currentName: name })
                try {
                    const envelope = await getEditState(imageId)
                    const resolved = await ensureAethSource(imageId)
                    if (!resolved) {
                        set((state) => ({
                            failures: [...state.failures, { imageId, name, message: i18n.t('export.warnNoDecode') }],
                            done: state.done + 1,
                        }))
                        continue
                    }
                    if (resolved.level !== 'l2') set({ warning: i18n.t('export.warnL1') })
                    const lensProfile = await useLens.getState().resolve(imageId)
                    const job = engine.prepare(resolved.source, envelope.state, lensProfile)
                    if (job.downscaled) set({ warning: i18n.t('export.warnDownscaled') })
                    const outputDir = resolveOutputDir(get().settings, entry)
                    const request = buildRequest(
                        get().settings,
                        imageId,
                        job.width,
                        job.height,
                        index + 1,
                        outputDir,
                        envelope.state.meta.appliedPreset,
                    )
                    const jobId = await exportBegin(request)
                    const completed = await job.stream(
                        (tile) => exportTile(jobId, tile),
                        () => get().cancelRequested,
                    )
                    job.release()
                    if (!completed) {
                        await exportCancel(jobId).catch(() => undefined)
                        break
                    }
                    const watermark = get().settings.watermark
                    if (watermark.enabled) {
                        const [outputWidth, outputHeight] = outputDims(get().settings, job.width, job.height)
                        const overlayImage = watermark.mode === 'image' ? await loadWatermarkImage(watermark.imagePath) : null
                        const overlay = await renderWatermarkPng(outputWidth, outputHeight, watermark, overlayImage)
                        if (overlay) await exportSetWatermark(jobId, overlay)
                    }
                    const path = await exportFinish(jobId)
                    set((state) => ({ done: state.done + 1, lastOutputPath: path }))
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    set((state) => ({ failures: [...state.failures, { imageId, name, message }], done: state.done + 1 }))
                }
            }
        } finally {
            engine.dispose()
            const cancelled = get().cancelRequested
            set({ running: false, currentName: '', finished: true })
            const failed = get().failures.length
            if (!cancelled && failed === 0 && get().lastOutputPath) useToast.getState().show(i18n.t('toast.exportDone'))
            else if (cancelled) useToast.getState().show(i18n.t('toast.exportCancelled'))
        }
    },
    retryFailed: () => {
        const failedIds = get().failures.map((failure) => failure.imageId)
        if (failedIds.length === 0) return
        set({ targets: failedIds })
        get().start()
    },
    runDng: async (imageId, name, entry) => {
        const outDir = resolveOutputDir(get().settings, entry)
        try {
            const result = await exportDng(imageId, outDir)
            useToast.getState().show(result.xmpInjected ? i18n.t('toast.dngDone') : i18n.t('toast.dngNoXmp'))
            revealItemInDir(result.path).catch(() => undefined)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            set({ dngPrompt: { imageId, name, message } })
        }
    },
    runEditedHandoff: async (imageId, name, entry, appPath) => {
        if (!entry) return
        let engine: ExportEngine
        try {
            engine = createExportEngine()
        } catch {
            useToast.getState().show(i18n.t('export.warnGpu'))
            return
        }
        useToast.getState().show(i18n.t('toast.editedRendering', { name }))
        try {
            await useEditStore.getState().flushPending()
            const envelope = await getEditState(imageId)
            const resolved = await ensureAethSource(imageId)
            if (!resolved) {
                useToast.getState().show(i18n.t('export.warnNoDecode'))
                return
            }
            const lensProfile = await useLens.getState().resolve(imageId)
            const job = engine.prepare(resolved.source, envelope.state, lensProfile)
            const settings: ExportSettings = {
                format: 'tiff',
                quality: 100,
                colorSpace: 'srgb',
                bits: 16,
                resizeMode: 'none',
                resizeValue: 0,
                metadata: 'all',
                filenameTemplate: '{name}-Edit',
                output: 'source',
                customDir: '',
                conflict: 'overwrite',
                watermark: DEFAULT_WATERMARK,
            }
            const request = buildRequest(settings, imageId, job.width, job.height, 1, dirname(entry.path), envelope.state.meta.appliedPreset)
            const jobId = await exportBegin(request)
            const completed = await job.stream(
                (tile) => exportTile(jobId, tile),
                () => false,
            )
            job.release()
            if (!completed) {
                await exportCancel(jobId).catch(() => undefined)
                return
            }
            const path = await exportFinish(jobId)
            await openWithEdited(path, appPath)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            useToast.getState().show(i18n.t('toast.editedFailed', { message }))
        } finally {
            engine.dispose()
        }
    },
    dismissDng: () => set({ dngPrompt: null }),
    dngToTiff: () => {
        const prompt = get().dngPrompt
        if (!prompt) return
        const settings = { ...get().settings, format: 'tiff' as RasterFormat, bits: 16 }
        persistSettings(settings)
        set({
            settings,
            dngPrompt: null,
            open: true,
            targets: [prompt.imageId],
            running: false,
            done: 0,
            total: 1,
            currentName: '',
            warning: null,
            failures: [],
            lastOutputPath: null,
            finished: false,
            cancelRequested: false,
            gpsNoticeNeeded: !gpsNoticeShown(),
        })
    },
}))
