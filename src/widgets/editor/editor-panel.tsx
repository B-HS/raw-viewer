import { useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorLayers } from './editor-layers'
import { HistoryPanel } from '../../components/HistoryPanel'

type EditorPanelProps = { disabled: boolean }
const EDITOR_PANELS = ['layers', 'history'] as const

export const EditorPanel: FC<EditorPanelProps> = ({ disabled }) => {
    const [panel, setPanel] = useState<(typeof EDITOR_PANELS)[number]>('layers')
    const { t } = useTranslation()
    return (
        <aside aria-label={t('editor.layers')} className='flex w-80 shrink-0 flex-col border-l border-neutral-800 bg-neutral-900 text-neutral-200'>
            <div role='tablist' aria-label={t('editor.layers')} className='flex border-b border-neutral-800 text-xs'>
                {EDITOR_PANELS.map((id) => (
                    <button
                        key={id}
                        type='button'
                        role='tab'
                        id={`editor-${id}`}
                        aria-selected={panel === id}
                        aria-controls='editor-panel'
                        onClick={() => setPanel(id)}
                        className={`flex-1 border-b-2 py-3 ${panel === id ? 'border-sky-400 text-neutral-100' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}>
                        {t(`editor.${id}`)}
                    </button>
                ))}
            </div>
            <div id='editor-panel' role='tabpanel' aria-labelledby={`editor-${panel}`} className='flex min-h-0 flex-1 flex-col overflow-y-auto'>
                {disabled ? (
                    <p className='px-4 py-8 text-center text-xs text-neutral-500'>{t('editor.loading')}</p>
                ) : (
                    <>
                        {panel === 'layers' && <EditorLayers />}
                        {panel === 'history' && <HistoryPanel />}
                    </>
                )}
            </div>
            <div className='border-t border-neutral-800 px-3 py-3 text-[10px] leading-relaxed text-neutral-500'>{t('editor.ready')}</div>
        </aside>
    )
}
