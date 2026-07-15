import { open as openFolder } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useEffect } from 'react'
import type { FC, PropsWithChildren } from 'react'
import { usePlaylist } from '../store/playlist'
import { useExportStore } from '../store/exportStore'
import type { ConflictPolicy } from '../types/ConflictPolicy'
import type { ExportColorSpace } from '../types/ExportColorSpace'
import type { ExportMetadata } from '../types/ExportMetadata'
import type { RasterFormat } from '../types/RasterFormat'
import type { ResizeMode } from '../types/ResizeMode'
import type { ExportOutputMode } from '../store/exportStore'

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

const METADATA: readonly (readonly [ExportMetadata, string])[] = [
    ['all', '전체'],
    ['gps-strip', 'GPS 제거'],
    ['none', '없음'],
]

const RESIZE_MODES: readonly (readonly [ResizeMode, string])[] = [
    ['none', '원본'],
    ['long-edge', '긴 변'],
    ['percent', '퍼센트'],
]

const CONFLICTS: readonly (readonly [ConflictPolicy, string])[] = [
    ['rename', '번호 추가'],
    ['overwrite', '덮어쓰기'],
    ['skip', '건너뛰기'],
]

const OUTPUTS: readonly (readonly [ExportOutputMode, string])[] = [
    ['source', '원본 폴더'],
    ['exported', 'Exported 하위'],
    ['custom', '지정 폴더'],
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
                    <h2 className='text-sm font-semibold'>DNG 변환 불가</h2>
                    <p className='mt-2 text-xs leading-relaxed text-neutral-400'>
                        {dngPrompt.name} 은(는) 현재 DNG 모자이크 변환을 지원하지 않습니다.
                    </p>
                    <p className='mt-1 break-all text-[10px] text-neutral-600'>{dngPrompt.message}</p>
                    <div className='mt-4 flex justify-end gap-2'>
                        <button
                            type='button'
                            onClick={() => useExportStore.getState().dismissDng()}
                            className='rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800'>
                            취소
                        </button>
                        <button
                            type='button'
                            onClick={() => useExportStore.getState().dngToTiff()}
                            className='rounded bg-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-white'>
                            16-bit TIFF로 내보내기
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

    const pickFolder = async () => {
        const selected = await openFolder({ directory: true, multiple: false, title: '출력 폴더 선택' }).catch(() => null)
        if (typeof selected === 'string') update({ output: 'custom', customDir: selected })
    }

    return (
        <div
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/60'
            onClick={() => !running && useExportStore.getState().close()}>
            <div
                onClick={(event) => event.stopPropagation()}
                className='flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 shadow-2xl'>
                <div className='flex items-center justify-between border-b border-neutral-800 px-5 py-3'>
                    <h2 className='text-sm font-semibold'>내보내기 {targets.length > 1 ? `(${targets.length}개)` : ''}</h2>
                    {!running && (
                        <button
                            type='button'
                            onClick={() => useExportStore.getState().close()}
                            className='rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200'>
                            ✕
                        </button>
                    )}
                </div>

                <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4'>
                    {gpsNoticeNeeded && (
                        <div className='flex items-start justify-between gap-3 rounded border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200'>
                            <span>
                                기본값은 GPS를 포함한 전체 메타데이터입니다. SNS 공유 시 위치가 노출될 수 있어 필요하면 &apos;GPS 제거&apos;를
                                선택하세요.
                            </span>
                            <button
                                type='button'
                                onClick={() => useExportStore.getState().acknowledgeGps()}
                                className='shrink-0 rounded px-2 py-0.5 text-amber-300 hover:bg-amber-900/40'>
                                확인
                            </button>
                        </div>
                    )}

                    <Field label='포맷'>
                        <Choice value={settings.format} options={FORMATS} onChange={(format) => update({ format })} />
                    </Field>

                    <Field label={`품질 ${settings.quality}`}>
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
                        <Field label='색 공간'>
                            <Choice value={settings.colorSpace} options={COLOR_SPACES} onChange={(colorSpace) => update({ colorSpace })} />
                        </Field>
                        <Field label='비트'>
                            <Choice
                                value={String(bitsDisabled ? 8 : settings.bits)}
                                options={[
                                    ['8', '8-bit'],
                                    ['16', '16-bit'],
                                ]}
                                disabled={bitsDisabled}
                                onChange={(value) => update({ bits: Number(value) })}
                            />
                        </Field>
                    </div>

                    <Field label='리사이즈'>
                        <div className='flex items-center gap-2'>
                            <Choice value={settings.resizeMode} options={RESIZE_MODES} onChange={(resizeMode) => update({ resizeMode })} />
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

                    <Field label='메타데이터'>
                        <Choice value={settings.metadata} options={METADATA} onChange={(metadata) => update({ metadata })} />
                    </Field>

                    <Field label='파일명 템플릿'>
                        <input
                            value={settings.filenameTemplate}
                            onChange={(event) => update({ filenameTemplate: event.target.value })}
                            spellCheck={false}
                            className='w-full rounded bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500'
                        />
                        <span className='truncate text-[11px] text-neutral-500'>
                            미리보기: {previewName(settings.filenameTemplate, firstName, settings.format)}
                        </span>
                    </Field>

                    <Field label='출력 위치'>
                        <Choice value={settings.output} options={OUTPUTS} onChange={(output) => update({ output })} />
                        {settings.output === 'custom' && (
                            <div className='flex items-center gap-2'>
                                <span className='min-w-0 flex-1 truncate rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-400'>
                                    {settings.customDir || '폴더가 지정되지 않았습니다'}
                                </span>
                                <button
                                    type='button'
                                    onClick={pickFolder}
                                    className='shrink-0 rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800'>
                                    폴더 선택
                                </button>
                            </div>
                        )}
                    </Field>

                    <Field label='충돌 처리'>
                        <Choice value={settings.conflict} options={CONFLICTS} onChange={(conflict) => update({ conflict })} />
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
                                {finished && !running && <span>{failures.length > 0 ? `실패 ${failures.length}건` : '완료'}</span>}
                            </div>
                            {failures.length > 0 && (
                                <ul className='max-h-24 overflow-y-auto rounded bg-neutral-950/60 px-2 py-1 text-[10px] text-red-300'>
                                    {failures.map((failure) => (
                                        <li key={failure.name} className='truncate'>
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
                            Finder에서 보기
                        </button>
                    )}
                    {running ? (
                        <button
                            type='button'
                            onClick={() => useExportStore.getState().cancel()}
                            className='rounded bg-red-900/70 px-4 py-1.5 text-xs font-medium text-red-100 hover:bg-red-800'>
                            취소
                        </button>
                    ) : (
                        <>
                            <button
                                type='button'
                                onClick={() => useExportStore.getState().close()}
                                className='rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800'>
                                닫기
                            </button>
                            <button
                                type='button'
                                disabled={startDisabled}
                                onClick={() => useExportStore.getState().start()}
                                className='rounded bg-neutral-200 px-4 py-1.5 text-xs font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40'>
                                {finished ? '다시 내보내기' : '내보내기'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
