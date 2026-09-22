import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { EDITOR_TOOLS } from '../../shared/constants/editor'
import { useUiStore } from '../../store/uiStore'
import { EditorIcon } from './editor-icon'

type EditorToolbarProps = { disabled: boolean }

export const EditorToolbar: FC<EditorToolbarProps> = ({ disabled }) => {
    const tool = useUiStore((state) => state.drawerTool)
    const color = useUiStore((state) => state.drawerColor)
    const { t } = useTranslation()

    return (
        <aside
            aria-label={t('editor.tools')}
            className='flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-neutral-800 bg-neutral-900 py-3'>
            {EDITOR_TOOLS.map((item) => (
                <button
                    key={item.id}
                    type='button'
                    disabled={disabled}
                    aria-pressed={tool === item.id}
                    aria-label={t(`panel.drawer.tool.${item.id}`)}
                    title={`${t(`panel.drawer.tool.${item.id}`)} (${item.key})`}
                    onClick={() => useUiStore.getState().setDrawerTool(item.id)}
                    className={`flex h-9 w-10 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-30 ${tool === item.id ? 'border-sky-400/40 bg-sky-500/15 text-sky-200' : 'border-transparent text-neutral-400 hover:bg-neutral-800 hover:text-white'}`}>
                    <EditorIcon tool={item.id} />
                </button>
            ))}
            <div className='mt-2 border-t border-neutral-700 pt-3'>
                <input
                    type='color'
                    value={color}
                    disabled={disabled}
                    aria-label={t('panel.drawer.color')}
                    title={t('panel.drawer.color')}
                    onChange={(event) => useUiStore.getState().setDrawerColor(event.target.value)}
                    className='h-8 w-8 cursor-pointer rounded border border-neutral-600 bg-transparent p-0.5'
                />
            </div>
        </aside>
    )
}
