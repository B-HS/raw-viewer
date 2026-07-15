import { getVersion } from '@tauri-apps/api/app'
import { useEffect, useRef, useState } from 'react'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { clearCache, getCacheStats } from '../../ipc/about'
import { useModalDismiss } from '../../lib/useModalDismiss'
import { useOverlays } from '../../store/overlays'
import { useSettings } from '../../store/settings'
import { useToast } from '../../store/toast'
import type { CacheStats } from '../../types/CacheStats'
import { formatBytes } from '../panels/MetaPanel/format'

const Segmented = <T extends string>({
    value,
    options,
    onChange,
}: {
    value: T
    options: readonly (readonly [T, string])[]
    onChange: (value: T) => void
}) => (
    <div className='flex flex-wrap gap-1'>
        {options.map(([option, label]) => (
            <button
                key={option}
                type='button'
                onClick={() => onChange(option)}
                aria-pressed={value === option}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                    value === option ? 'bg-neutral-200 text-neutral-900' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}>
                {label}
            </button>
        ))}
    </div>
)

const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
    <div className='flex items-center justify-between gap-4'>
        <span className='text-xs text-neutral-400'>{label}</span>
        {children}
    </div>
)

const SectionTitle: FC<{ children: ReactNode }> = ({ children }) => (
    <h3 className='mt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500'>{children}</h3>
)

export const SettingsDialog: FC = () => {
    const dialogRef = useRef<HTMLDivElement>(null)
    const { t } = useTranslation()
    const open = useOverlays((state) => state.settingsOpen)
    const language = useSettings((state) => state.language)
    const theme = useSettings((state) => state.theme)
    const viewportBackground = useSettings((state) => state.viewportBackground)
    const preloadRadius = useSettings((state) => state.preloadRadius)
    const l2Policy = useSettings((state) => state.l2Policy)
    const [version, setVersion] = useState('')
    const [stats, setStats] = useState<CacheStats | null>(null)

    const close = () => useOverlays.getState().closeSettings()

    const refreshStats = () =>
        getCacheStats()
            .then(setStats)
            .catch(() => setStats(null))

    const clear = async (kind: 'all' | 'l0' | 'l1') => {
        await clearCache(kind).catch(() => undefined)
        useToast.getState().show(t('toast.cacheCleared'))
        refreshStats()
    }

    useEffect(() => {
        if (!open) return
        getVersion()
            .then(setVersion)
            .catch(() => setVersion(''))
        refreshStats()
    }, [open])

    useModalDismiss(dialogRef, close)

    if (!open) return null

    return (
        <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/60' onClick={close}>
            <div
                ref={dialogRef}
                role='dialog'
                aria-modal='true'
                aria-label={t('settings.title')}
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
                className='flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 shadow-2xl outline-none'>
                <div className='flex items-center justify-between border-b border-neutral-800 px-5 py-3'>
                    <h2 className='text-sm font-semibold'>{t('settings.title')}</h2>
                    <button
                        type='button'
                        onClick={close}
                        aria-label={t('common.close')}
                        className='rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200'>
                        ✕
                    </button>
                </div>

                <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4'>
                    <SectionTitle>{t('settings.general')}</SectionTitle>
                    <Field label={t('settings.language')}>
                        <Segmented
                            value={language}
                            onChange={(value) => useSettings.getState().setLanguage(value)}
                            options={[
                                ['system', t('settings.languageSystem')],
                                ['ko', t('settings.languageKo')],
                                ['en', t('settings.languageEn')],
                            ]}
                        />
                    </Field>
                    <Field label={t('settings.theme')}>
                        <Segmented
                            value={theme}
                            onChange={(value) => useSettings.getState().setTheme(value)}
                            options={[
                                ['system', t('settings.themeSystem')],
                                ['dark', t('settings.themeDark')],
                                ['light', t('settings.themeLight')],
                            ]}
                        />
                    </Field>
                    <Field label={t('settings.viewportBackground')}>
                        <input
                            type='color'
                            value={viewportBackground}
                            onChange={(event) => useSettings.getState().setViewportBackground(event.target.value)}
                            aria-label={t('settings.viewportBackground')}
                            className='h-7 w-12 cursor-pointer rounded border border-neutral-700 bg-neutral-800'
                        />
                    </Field>

                    <SectionTitle>{t('settings.performance')}</SectionTitle>
                    <Field label={`${t('settings.preloadRadius')} ±${preloadRadius}`}>
                        <input
                            type='range'
                            min={0}
                            max={10}
                            step={1}
                            value={preloadRadius}
                            onChange={(event) => useSettings.getState().setPreloadRadius(Number(event.target.value))}
                            aria-label={t('settings.preloadRadius')}
                            className='w-40 accent-neutral-300'
                        />
                    </Field>
                    <Field label={t('settings.l2Policy')}>
                        <Segmented
                            value={l2Policy}
                            onChange={(value) => useSettings.getState().setL2Policy(value)}
                            options={[
                                ['always', t('settings.l2Always')],
                                ['idle', t('settings.l2Idle')],
                                ['zoom', t('settings.l2Zoom')],
                            ]}
                        />
                    </Field>
                    <p className='text-[10px] text-neutral-500'>{t('settings.performanceNote')}</p>

                    <SectionTitle>{t('settings.cache')}</SectionTitle>
                    <div className='flex flex-col gap-1 text-xs text-neutral-400'>
                        <div className='flex justify-between'>
                            <span>{t('settings.cacheL0')}</span>
                            <span className='font-mono text-neutral-300'>{stats ? formatBytes(stats.l0Bytes) : '—'}</span>
                        </div>
                        <div className='flex justify-between'>
                            <span>{t('settings.cacheL1')}</span>
                            <span className='font-mono text-neutral-300'>{stats ? formatBytes(stats.l1Bytes) : '—'}</span>
                        </div>
                        <div className='flex justify-between'>
                            <span>{t('settings.cacheTotal')}</span>
                            <span className='font-mono text-neutral-300'>{stats ? formatBytes(stats.totalBytes) : '—'}</span>
                        </div>
                    </div>
                    <div className='flex gap-1'>
                        <button
                            type='button'
                            onClick={() => clear('l0')}
                            className='rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800'>
                            {t('settings.clearL0')}
                        </button>
                        <button
                            type='button'
                            onClick={() => clear('l1')}
                            className='rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800'>
                            {t('settings.clearL1')}
                        </button>
                        <button
                            type='button'
                            onClick={() => clear('all')}
                            className='rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800'>
                            {t('settings.clearAll')}
                        </button>
                    </div>

                    <SectionTitle>{t('settings.info')}</SectionTitle>
                    <Field label={t('settings.version')}>
                        <span className='font-mono text-xs text-neutral-300'>{version || '—'}</span>
                    </Field>
                    <div>
                        <button
                            type='button'
                            onClick={() => useOverlays.getState().openAbout()}
                            className='rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800'>
                            {t('settings.viewLicenses')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
