import { useEffect, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditStore } from '../../store/editStore'
import { PRESET_SECTIONS, usePresetStore } from '../../store/presetStore'
import type { PresetSectionKey } from '../../store/presetStore'
import type { PresetInfo } from '../../types/PresetInfo'

const groupByFolder = (presets: PresetInfo[]) => {
    const map = new Map<string, PresetInfo[]>()
    for (const preset of presets) {
        const list = map.get(preset.folder) ?? []
        list.push(preset)
        map.set(preset.folder, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}

const SaveForm: FC<{ onClose: () => void }> = ({ onClose }) => {
    const { t } = useTranslation()
    const [name, setName] = useState('')
    const [folder, setFolder] = useState('')
    const [mask, setMask] = useState<Set<PresetSectionKey>>(new Set(PRESET_SECTIONS))

    const toggle = (section: PresetSectionKey) =>
        setMask((current) => {
            const next = new Set(current)
            if (next.has(section)) next.delete(section)
            else next.add(section)
            return next
        })

    const submit = async () => {
        if (!name.trim() || mask.size === 0) return
        const ok = await usePresetStore.getState().save(name.trim(), folder.trim(), [...mask])
        if (ok) onClose()
    }

    return (
        <div className='flex flex-col gap-2 border-b border-neutral-800 bg-neutral-950/40 px-3 py-3'>
            <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('preset.namePlaceholder')}
                className='w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500'
            />
            <input
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                placeholder={t('preset.folderPlaceholder')}
                className='w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500'
            />
            <div className='grid grid-cols-2 gap-1'>
                {PRESET_SECTIONS.map((section) => (
                    <label key={section} className='flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-300'>
                        <input type='checkbox' checked={mask.has(section)} onChange={() => toggle(section)} className='accent-neutral-400' />
                        {t(`preset.section.${section}`)}
                    </label>
                ))}
            </div>
            <div className='flex justify-end gap-2'>
                <button type='button' onClick={onClose} className='rounded px-2.5 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800'>
                    {t('preset.cancel')}
                </button>
                <button
                    type='button'
                    disabled={!name.trim() || mask.size === 0}
                    onClick={submit}
                    className='rounded bg-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-900 hover:bg-white disabled:opacity-40'>
                    {t('preset.save')}
                </button>
            </div>
        </div>
    )
}

export const PresetPanel: FC = () => {
    const { t } = useTranslation()
    const presets = usePresetStore((state) => state.presets)
    const loaded = usePresetStore((state) => state.loaded)
    const hasImage = useEditStore((state) => state.state !== null)
    const [saving, setSaving] = useState(false)
    const [confirmId, setConfirmId] = useState<string | null>(null)

    useEffect(() => {
        if (!loaded) usePresetStore.getState().load()
    }, [loaded])

    const slotOf = (preset: PresetInfo) => {
        const index = presets.indexOf(preset)
        return index >= 0 && index < 9 ? index + 1 : null
    }

    const groups = groupByFolder(presets)

    return (
        <aside className='flex h-full w-80 flex-col border-l border-neutral-800 bg-neutral-900 text-neutral-200'>
            <div className='flex items-center justify-between border-b border-neutral-800 px-3 py-2'>
                <span className='text-xs font-semibold uppercase tracking-wide text-neutral-400'>{t('preset.title')}</span>
                <div className='flex items-center gap-1'>
                    <button
                        type='button'
                        onClick={() => usePresetStore.getState().importFromFile()}
                        className='rounded px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'>
                        {t('preset.import')}
                    </button>
                    <button
                        type='button'
                        disabled={!hasImage}
                        onClick={() => setSaving((value) => !value)}
                        className='rounded px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40'>
                        {t('preset.saveCurrent')}
                    </button>
                </div>
            </div>

            {saving && hasImage && <SaveForm onClose={() => setSaving(false)} />}

            {presets.length === 0 ? (
                <div className='flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-500'>
                    {loaded ? t('preset.empty') : t('preset.loading')}
                </div>
            ) : (
                <div className='min-h-0 flex-1 overflow-y-auto py-1'>
                    {groups.map(([folder, list]) => (
                        <div key={folder || 'root'} className='mb-1'>
                            <div className='px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-neutral-600'>
                                {folder || t('preset.root')}
                            </div>
                            {list.map((preset) => (
                                <div key={preset.id} className='group flex items-center gap-2 px-2 py-0.5'>
                                    <button
                                        type='button'
                                        disabled={!hasImage}
                                        onClick={() => usePresetStore.getState().applyToCurrent(preset.id, preset.name)}
                                        className='flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-40'>
                                        <span className='text-neutral-500'>{preset.source === 'lr-import' ? '◈' : '⬢'}</span>
                                        <span className='min-w-0 flex-1 truncate'>{preset.name}</span>
                                        {slotOf(preset) && <span className='shrink-0 text-[10px] text-neutral-600'>⌥{slotOf(preset)}</span>}
                                    </button>
                                    <button
                                        type='button'
                                        aria-label={t('preset.export')}
                                        title={t('preset.export')}
                                        onClick={() => usePresetStore.getState().exportToFile(preset.id, preset.name)}
                                        className='shrink-0 rounded px-1.5 py-0.5 text-[10px] text-neutral-600 opacity-0 hover:bg-neutral-800 hover:text-neutral-300 group-hover:opacity-100'>
                                        ↥
                                    </button>
                                    {!preset.builtin && (
                                        <button
                                            type='button'
                                            onClick={() => {
                                                if (confirmId === preset.id) {
                                                    usePresetStore.getState().remove(preset.id)
                                                    setConfirmId(null)
                                                } else {
                                                    setConfirmId(preset.id)
                                                }
                                            }}
                                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                                                confirmId === preset.id
                                                    ? 'text-red-300 opacity-100 hover:bg-red-900/40'
                                                    : 'text-neutral-600 opacity-0 hover:bg-neutral-800 hover:text-neutral-300 group-hover:opacity-100'
                                            }`}>
                                            {confirmId === preset.id ? t('preset.delete') : '✕'}
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </aside>
    )
}
