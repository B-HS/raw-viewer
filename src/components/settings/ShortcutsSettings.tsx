import { useEffect, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { activeConflicts, eventToBinding, formatBinding, SHORTCUT_ACTIONS, SHORTCUT_SECTIONS } from '../../shortcuts/keymap'
import { useSettings } from '../../store/settings'

export const ShortcutsSettings: FC = () => {
    const { t } = useTranslation()
    const overrides = useSettings((state) => state.shortcutOverrides)
    const [recordingId, setRecordingId] = useState<string | null>(null)

    const conflicts = activeConflicts(overrides)

    useEffect(() => {
        if (!recordingId) return
        const onKey = (event: KeyboardEvent) => {
            event.preventDefault()
            event.stopPropagation()
            if (event.code === 'Escape') return setRecordingId(null)
            const binding = eventToBinding(event)
            if (!binding) return
            useSettings.getState().setShortcutBinding(recordingId, binding)
            setRecordingId(null)
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [recordingId])

    return (
        <div className='flex flex-col gap-3'>
            <div className='flex items-center justify-between gap-4'>
                <div>
                    <div className='text-xs text-neutral-300'>{t('settings.shortcutsPreset')}</div>
                    <div className='text-[10px] text-neutral-500'>{t('settings.shortcutsPresetDefault')}</div>
                </div>
                <button
                    type='button'
                    onClick={() => useSettings.getState().resetShortcutBindings()}
                    className='rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800'>
                    {t('settings.shortcutsResetAll')}
                </button>
            </div>
            <p className='text-[10px] text-neutral-500'>{t('settings.shortcutsHint')}</p>

            {SHORTCUT_SECTIONS.map((section) => (
                <div key={section} className='flex flex-col gap-0.5'>
                    <h4 className='mt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500'>{t(`shortcut.section.${section}`)}</h4>
                    {SHORTCUT_ACTIONS.filter((action) => action.section === section).map((action) => {
                        const binding = overrides[action.id] ?? action.binding
                        const conflict = conflicts.has(action.id)
                        const overridden = overrides[action.id] !== undefined
                        const recording = recordingId === action.id
                        return (
                            <div key={action.id} className='flex items-center justify-between gap-3 py-0.5'>
                                <span className='min-w-0 truncate text-xs text-neutral-300'>{t(action.label)}</span>
                                <div className='flex shrink-0 items-center gap-1'>
                                    {conflict && (
                                        <span title={t('settings.shortcutsConflict')} className='text-[11px] text-amber-400'>
                                            ⚠
                                        </span>
                                    )}
                                    <button
                                        type='button'
                                        onClick={() => setRecordingId(recording ? null : action.id)}
                                        aria-label={t('settings.shortcutsRebind', { name: t(action.label) })}
                                        className={`min-w-[72px] rounded border px-2 py-0.5 text-center font-mono text-[11px] ${
                                            recording
                                                ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                                                : conflict
                                                  ? 'border-amber-500/60 text-amber-300 hover:bg-neutral-800'
                                                  : 'border-neutral-700 text-neutral-200 hover:bg-neutral-800'
                                        }`}>
                                        {recording ? t('settings.shortcutsRecording') : formatBinding(binding)}
                                    </button>
                                    <button
                                        type='button'
                                        disabled={!overridden}
                                        onClick={() => useSettings.getState().resetShortcutBinding(action.id)}
                                        title={t('settings.shortcutsResetOne', { name: t(action.label) })}
                                        aria-label={t('settings.shortcutsResetOne', { name: t(action.label) })}
                                        className={`rounded px-1.5 py-0.5 text-xs ${overridden ? 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200' : 'cursor-default text-neutral-700'}`}>
                                        ↺
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            ))}
        </div>
    )
}
