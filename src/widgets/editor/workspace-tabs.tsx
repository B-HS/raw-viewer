import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useGridView } from '../../store/gridView'
import { useUiStore } from '../../store/uiStore'
import { usePlaylist } from '../../store/playlist'
import { useEditStore } from '../../store/editStore'

const WORKSPACES = ['photo', 'editor'] as const

export const WorkspaceTabs: FC = () => {
    const workspace = useUiStore((state) => state.workspace)
    const gpuError = useUiStore((state) => state.gpuError)
    const entry = usePlaylist((state) => state.entries[state.currentIndex])
    const edited = useEditStore((state) => state.dirtyFromDefault)
    const { t } = useTranslation()
    const unavailable = gpuError || entry?.isAnimated === true

    return (
        <div className='flex h-11 shrink-0 items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-950 px-3'>
            <div className='flex h-full gap-1' role='tablist' aria-label={t('editor.workspace')}>
                {WORKSPACES.map((id) => (
                    <button
                        key={id}
                        id={`workspace-${id}`}
                        type='button'
                        role='tab'
                        aria-selected={workspace === id}
                        aria-controls='workspace-content'
                        disabled={id === 'editor' && unavailable}
                        title={id === 'editor' && unavailable ? t('editor.unavailable') : t(`editor.${id}`)}
                        onClick={() => {
                            useGridView.getState().close()
                            useUiStore.getState().setWorkspace(id)
                        }}
                        className={`border-b-2 px-5 text-xs font-medium transition-colors disabled:opacity-40 ${workspace === id ? 'border-sky-400 bg-sky-400/5 text-sky-200' : 'border-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100'}`}>
                        {t(`editor.${id}`)}
                    </button>
                ))}
            </div>
            <div className='flex min-w-0 items-center gap-2 text-xs text-neutral-400'>
                {edited && <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400' title={t('common.edited')} />}
                <span className='truncate'>{entry?.fileName}</span>
            </div>
        </div>
    )
}
