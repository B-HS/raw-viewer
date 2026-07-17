import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useEffect } from 'react'
import type { FC, PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'
import { loadWatermarkImage, WATERMARK_POSITIONS } from '../lib/watermark'
import { usePlaylist } from '../store/playlist'
import { useExportStore } from '../store/exportStore'
import type { WatermarkMode, WatermarkSettings } from '../lib/watermark'
import type { ConflictPolicy } from '../types/ConflictPolicy'
import type { ExportColorSpace } from '../types/ExportColorSpace'
import type { ExportMetadata } from '../types/ExportMetadata'
import type { RasterFormat } from '../types/RasterFormat'
import type { ResizeMode } from '../types/ResizeMode'
import type { ExportOutputMode } from '../store/exportStore'

const basename = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

const FORMATS: readonly (readonly [RasterFormat, string])[] = [
    ['jpeg', 'JPEG'],
    ['png', 'PNG'],
    ['tiff', 'TIFF'],
    ['webp', 'WebP'],
]

const COLOR_SPACES: readonly (readonly [ExportColorSpace, string])[] = [
    ['srgb', 'sRGB'],
    ['display-p3', 'Display P3'],
    ['rec2020', 'Rec.2020'],
    ['adobe-rgb', 'Adobe RGB'],
    ['prophoto', 'ProPhoto'],
]

const EXTENSIONS: Record<RasterFormat, string> = { jpeg: 'jpg', png: 'png', tiff: 'tif', webp: 'webp' }

const pad = (value: number, width: number) => String(value).padStart(width, '0')

const formatDate = (fmt: string, now: Date) =>
    fmt
        .replace(/YYYY/g, String(now.getFullYear()))
        .replace(/YY/g, pad(now.getFullYear() % 100, 2))
        .replace(/MM/g, pad(now.getMonth() + 1, 2))
        .replace(/DD/g, pad(now.getDate(), 2))
        .replace(/HH/g, pad(now.getHours(), 2))
        .replace(/mm/g, pad(now.getMinutes(), 2))
        .replace(/ss/g, pad(now.getSeconds(), 2))

const previewName = (template: string, fileName: string, format: RasterFormat) => {
    const stem = fileName.replace(/\.[^./\\]+$/, '')
    const now = new Date()
    const resolved = template
        .replace(/\{name\}/g, stem)
        .replace(/\{name_lower\}/g, stem.toLowerCase())
        .replace(/\{seq:(\d+)\}/g, (_match, width: string) => pad(1, Number(width)))
        .replace(/\{seq\}/g, '1')
        .replace(/\{date:([^}]+)\}/g, (_match, fmt: string) => formatDate(fmt, now))
        .replace(/\{time:([^}]+)\}/g, (_match, fmt: string) => formatDate(fmt, now))
    return `${resolved || stem}.${EXTENSIONS[format]}`
}

const Choice = <T extends string>({
    value,
    options,
    onChange,
    disabled,
}: {
    value: T
    options: readonly (readonly [T, string])[]
    onChange: (value: T) => void
    disabled?: boolean
}) => (
    <div className='flex flex-wrap gap-1'>
        {options.map(([option, label]) => (
            <button
                key={option}
                type='button'
                disabled={disabled}
                onClick={() => onChange(option)}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                    value === option ? 'bg-neutral-200 text-neutral-900' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}>
                {label}
            </button>
        ))}
    </div>
)

const Field: FC<PropsWithChildren<{ label: string }>> = ({ label, children }) => (
    <div className='flex flex-col gap-1.5'>
        <span className='text-[11px] font-medium uppercase tracking-wide text-neutral-500'>{label}</span>
        {children}
    </div>
)

export const ExportDialog: FC = () => {
    const { t } = useTranslation()
    const open = useExportStore((state) => state.open)
    const dngPrompt = useExportStore((state) => state.dngPrompt)
    const settings = useExportStore((state) => state.settings)
    const targets = useExportStore((state) => state.targets)
    const running = useExportStore((state) => state.running)
    const finished = useExportStore((state) => state.finished)
    const done = useExportStore((state) => state.done)
    const total = useExportStore((state) => state.total)
    const currentName = useExportStore((state) => state.currentName)
    const warning = useExportStore((state) => state.warning)
    const failures = useExportStore((state) => state.failures)
    const lastOutputPath = useExportStore((state) => state.lastOutputPath)
    const gpsNoticeNeeded = useExportStore((state) => state.gpsNoticeNeeded)
    const firstName = usePlaylist((state) => state.entries.find((entry) => entry.imageId === targets[0])?.fileName ?? 'IMG_0001.ARW')

    const metadataOptions: readonly (readonly [ExportMetadata, string])[] = [
        ['all', t('export.metaAll')],
        ['gps-strip', t('export.metaGpsStrip')],
        ['none', t('export.metaNone')],
    ]
    const resizeOptions: readonly (readonly [ResizeMode, string])[] = [
        ['none', t('export.resizeNone')],
        ['long-edge', t('export.resizeLongEdge')],
        ['percent', t('export.resizePercent')],
    ]
    const conflictOptions: readonly (readonly [ConflictPolicy, string])[] = [
        ['rename', t('export.conflictRename')],
        ['overwrite', t('export.conflictOverwrite')],
        ['skip', t('export.conflictSkip')],
    ]
    const outputOptions: readonly (readonly [ExportOutputMode, string])[] = [
        ['source', t('export.outputSource')],
        ['exported', t('export.outputExported')],
        ['custom', t('export.outputCustom')],
    ]

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            if (useExportStore.getState().dngPrompt) {
                useExportStore.getState().dismissDng()
                return
            }
            if (useExportStore.getState().open && !useExportStore.getState().running) useExportStore.getState().close()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    if (dngPrompt)
        return (
            <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60'>
                <div className='w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-5 text-neutral-200 shadow-2xl'>
                    <h2 className='text-sm font-semibold'>{t('export.dngTitle')}</h2>
                    <p className='mt-2 text-xs leading-relaxed text-neutral-400'>{t('export.dngBody', { name: dngPrompt.name })}</p>
                    <p className='mt-1 break-all text-[10px] text-neutral-600'>{dngPrompt.message}</p>
                    <div className='mt-4 flex justify-end gap-2'>
                        <button
                            type='button'
                            onClick={() => useExportStore.getState().dismissDng()}
                            className='rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800'>
                            {t('export.cancel')}
                        </button>
                        <button
                            type='button'
                            onClick={() => useExportStore.getState().dngToTiff()}
                            className='rounded bg-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-white'>
                            {t('export.dngToTiff')}
                        </button>
                    </div>
                </div>
            </div>
        )

    if (!open) return null

    const update = useExportStore.getState().update
    const bitsDisabled = settings.format !== 'png' && settings.format !== 'tiff'
    const qualityDisabled = settings.format !== 'jpeg' && settings.format !== 'webp'
    const customMissing = settings.output === 'custom' && !settings.customDir
    const startDisabled = running || targets.length === 0 || customMissing || settings.filenameTemplate.trim().length === 0
    const percent = total > 0 ? Math.round((done / total) * 100) : 0

    const updateWatermark = (patch: Partial<WatermarkSettings>) => update({ watermark: { ...settings.watermark, ...patch } })

    const pickFolder = async () => {
        const selected = await openDialog({ directory: true, multiple: false, title: t('export.pickFolderTitle') }).catch(() => null)
        if (typeof selected === 'string') update({ output: 'custom', customDir: selected })
    }

    const pickWatermarkImage = async () => {
        const selected = await openDialog({
            directory: false,
            multiple: false,
            title: t('export.watermarkPickTitle'),
            filters: [{ name: 'PNG', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        }).catch(() => null)
        if (typeof selected !== 'string') return
        await loadWatermarkImage(selected).catch(() => null)
        updateWatermark({ mode: 'image', imagePath: selected })
    }

    return (
        <div
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/60'
            onClick={() => !running && useExportStore.getState().close()}>
            <div
                onClick={(event) => event.stopPropagation()}
                className='flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 shadow-2xl'>
                <div className='flex items-center justify-between border-b border-neutral-800 px-5 py-3'>
                    <h2 className='text-sm font-semibold'>
                        {targets.length > 1 ? t('export.titleCount', { count: targets.length }) : t('export.title')}
                    </h2>
                    {!running && (
                        <button
                            type='button'
                            onClick={() => useExportStore.getState().close()}
                            title={t('common.close')}
                            aria-label={t('common.close')}
                            className='rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200'>
                            ✕
                        </button>
                    )}
                </div>

                <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4'>
                    {gpsNoticeNeeded && (
                        <div className='flex items-start justify-between gap-3 rounded border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200'>
                            <span>{t('export.gpsNotice')}</span>
                            <button
                                type='button'
                                onClick={() => useExportStore.getState().acknowledgeGps()}
                                className='shrink-0 rounded px-2 py-0.5 text-amber-300 hover:bg-amber-900/40'>
                                {t('common.confirm')}
                            </button>
                        </div>
                    )}

                    <Field label={t('export.format')}>
                        <Choice value={settings.format} options={FORMATS} onChange={(format) => update({ format })} />
                    </Field>

                    <Field label={t('export.quality', { value: settings.quality })}>
                        <input
                            type='range'
                            min={1}
                            max={100}
                            step={1}
                            disabled={qualityDisabled}
                            value={settings.quality}
                            onChange={(event) => update({ quality: Number(event.target.value) })}
                            className='w-full accent-neutral-300 disabled:opacity-40'
                        />
                    </Field>

                    <div className='flex gap-6'>
                        <Field label={t('export.colorSpace')}>
                            <Choice value={settings.colorSpace} options={COLOR_SPACES} onChange={(colorSpace) => update({ colorSpace })} />
                        </Field>
                        <Field label={t('export.bits')}>
                            <Choice
                                value={String(bitsDisabled ? 8 : settings.bits)}
                                options={[
                                    ['8', t('export.bit8')],
                                    ['16', t('export.bit16')],
                                ]}
                                disabled={bitsDisabled}
                                onChange={(value) => update({ bits: Number(value) })}
                            />
                        </Field>
                    </div>

                    <Field label={t('export.resize')}>
                        <div className='flex items-center gap-2'>
                            <Choice value={settings.resizeMode} options={resizeOptions} onChange={(resizeMode) => update({ resizeMode })} />
                            {settings.resizeMode !== 'none' && (
                                <div className='flex items-center gap-1'>
                                    <input
                                        type='number'
                                        min={1}
                                        value={settings.resizeValue}
                                        onChange={(event) => update({ resizeValue: Math.max(1, Number(event.target.value)) })}
                                        className='w-20 rounded bg-neutral-800 px-2 py-1 text-right text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500'
                                    />
                                    <span className='text-xs text-neutral-500'>{settings.resizeMode === 'percent' ? '%' : 'px'}</span>
                                </div>
                            )}
                        </div>
                    </Field>

                    <Field label={t('export.metadata')}>
                        <Choice value={settings.metadata} options={metadataOptions} onChange={(metadata) => update({ metadata })} />
                    </Field>

                    <Field label={t('export.filenameTemplate')}>
                        <input
                            value={settings.filenameTemplate}
                            onChange={(event) => update({ filenameTemplate: event.target.value })}
                            spellCheck={false}
                            className='w-full rounded bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500'
                        />
                        <span className='truncate text-[11px] text-neutral-500'>
                            {t('export.preview', { name: previewName(settings.filenameTemplate, firstName, settings.format) })}
                        </span>
                    </Field>

                    <Field label={t('export.output')}>
                        <Choice value={settings.output} options={outputOptions} onChange={(output) => update({ output })} />
                        {settings.output === 'custom' && (
                            <div className='flex items-center gap-2'>
                                <span className='min-w-0 flex-1 truncate rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-400'>
                                    {settings.customDir || t('export.noFolder')}
                                </span>
                                <button
                                    type='button'
                                    onClick={pickFolder}
                                    className='shrink-0 rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800'>
                                    {t('export.pickFolder')}
                                </button>
                            </div>
                        )}
                    </Field>

                    <Field label={t('export.conflict')}>
                        <Choice value={settings.conflict} options={conflictOptions} onChange={(conflict) => update({ conflict })} />
                    </Field>

                    <Field label={t('export.watermark')}>
                        <label className='flex cursor-pointer items-center gap-2 text-xs text-neutral-300'>
                            <input
                                type='checkbox'
                                checked={settings.watermark.enabled}
                                onChange={(event) => updateWatermark({ enabled: event.target.checked })}
                                className='accent-neutral-300'
                            />
                            {t('export.watermarkEnable')}
                        </label>
                        {settings.watermark.enabled && (
                            <div className='mt-1 flex flex-col gap-3 rounded border border-neutral-800 bg-neutral-950/40 p-3'>
                                <Choice
                                    value={settings.watermark.mode}
                                    options={[
                                        ['text', t('export.watermarkText')],
                                        ['image', t('export.watermarkImage')],
                                    ]}
                                    onChange={(mode: WatermarkMode) => updateWatermark({ mode })}
                                />
                                {settings.watermark.mode === 'text' ? (
                                    <input
                                        value={settings.watermark.text}
                                        onChange={(event) => updateWatermark({ text: event.target.value })}
                                        placeholder={t('export.watermarkContent')}
                                        spellCheck={false}
                                        className='w-full rounded bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500'
                                    />
                                ) : (
                                    <div className='flex items-center gap-2'>
                                        <span className='min-w-0 flex-1 truncate rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-400'>
                                            {basename(settings.watermark.imagePath) || t('export.watermarkNoImage')}
                                        </span>
                                        <button
                                            type='button'
                                            onClick={pickWatermarkImage}
                                            className='shrink-0 rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800'>
                                            {t('export.watermarkPickImage')}
                                        </button>
                                    </div>
                                )}
                                <div className='flex gap-4'>
                                    <div className='flex flex-col gap-1'>
                                        <span className='text-[10px] uppercase tracking-wide text-neutral-500'>{t('export.watermarkPosition')}</span>
                                        <div className='grid grid-cols-3 gap-1'>
                                            {WATERMARK_POSITIONS.map((position) => (
                                                <button
                                                    key={position}
                                                    type='button'
                                                    aria-label={t(`export.wmPos.${position}`)}
                                                    onClick={() => updateWatermark({ position })}
                                                    className={`h-5 w-6 rounded-sm ${
                                                        settings.watermark.position === position
                                                            ? 'bg-neutral-200'
                                                            : 'bg-neutral-800 hover:bg-neutral-700'
                                                    }`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <div className='flex flex-1 flex-col gap-2'>
                                        <label className='flex flex-col gap-1'>
                                            <span className='text-[10px] uppercase tracking-wide text-neutral-500'>
                                                {t('export.watermarkSize', { value: settings.watermark.sizePercent })}
                                            </span>
                                            <input
                                                type='range'
                                                min={1}
                                                max={settings.watermark.mode === 'text' ? 20 : 100}
                                                value={settings.watermark.sizePercent}
                                                onChange={(event) => updateWatermark({ sizePercent: Number(event.target.value) })}
                                                className='w-full accent-neutral-300'
                                            />
                                        </label>
                                        <label className='flex flex-col gap-1'>
                                            <span className='text-[10px] uppercase tracking-wide text-neutral-500'>
                                                {t('export.watermarkOpacity', { value: settings.watermark.opacity })}
                                            </span>
                                            <input
                                                type='range'
                                                min={0}
                                                max={100}
                                                value={settings.watermark.opacity}
                                                onChange={(event) => updateWatermark({ opacity: Number(event.target.value) })}
                                                className='w-full accent-neutral-300'
                                            />
                                        </label>
                                        <label className='flex flex-col gap-1'>
                                            <span className='text-[10px] uppercase tracking-wide text-neutral-500'>
                                                {t('export.watermarkMargin', { value: settings.watermark.marginPercent })}
                                            </span>
                                            <input
                                                type='range'
                                                min={0}
                                                max={25}
                                                value={settings.watermark.marginPercent}
                                                onChange={(event) => updateWatermark({ marginPercent: Number(event.target.value) })}
                                                className='w-full accent-neutral-300'
                                            />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}
                    </Field>

                    {warning && (
                        <div className='rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200'>{warning}</div>
                    )}

                    {(running || finished) && (
                        <div className='flex flex-col gap-1.5'>
                            <div className='h-2 overflow-hidden rounded bg-neutral-800'>
                                <div className='h-full rounded bg-neutral-300 transition-[width]' style={{ width: `${percent}%` }} />
                            </div>
                            <div className='flex items-center justify-between text-[11px] text-neutral-400'>
                                <span>
                                    {done} / {total}
                                    {running && currentName ? ` · ${currentName}` : ''}
                                </span>
                                {finished && !running && (
                                    <span>{failures.length > 0 ? t('export.failedCount', { count: failures.length }) : t('export.done')}</span>
                                )}
                            </div>
                            {failures.length > 0 && (
                                <ul className='max-h-24 overflow-y-auto rounded bg-neutral-950/60 px-2 py-1 text-[10px] text-red-300'>
                                    {failures.map((failure) => (
                                        <li key={failure.imageId} className='truncate'>
                                            {failure.name}: {failure.message}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

                <div className='flex items-center justify-end gap-2 border-t border-neutral-800 px-5 py-3'>
                    {finished && lastOutputPath && !running && (
                        <button
                            type='button'
                            onClick={() => revealItemInDir(lastOutputPath).catch(() => undefined)}
                            className='mr-auto rounded border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800'>
                            {t('export.reveal')}
                        </button>
                    )}
                    {running ? (
                        <button
                            type='button'
                            onClick={() => useExportStore.getState().cancel()}
                            className='rounded bg-red-900/70 px-4 py-1.5 text-xs font-medium text-red-100 hover:bg-red-800'>
                            {t('export.cancel')}
                        </button>
                    ) : (
                        <>
                            <button
                                type='button'
                                onClick={() => useExportStore.getState().close()}
                                className='rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800'>
                                {t('export.close')}
                            </button>
                            {finished && failures.length > 0 && (
                                <button
                                    type='button'
                                    onClick={() => useExportStore.getState().retryFailed()}
                                    className='rounded border border-amber-700/60 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900/40'>
                                    {t('export.retryFailed', { count: failures.length })}
                                </button>
                            )}
                            <button
                                type='button'
                                disabled={startDisabled}
                                onClick={() => useExportStore.getState().start()}
                                className='rounded bg-neutral-200 px-4 py-1.5 text-xs font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40'>
                                {finished ? t('export.rerun') : t('export.run')}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
