import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { EDITOR_PERCENT, EDITOR_SIZE } from '../../shared/constants/editor'
import { useUiStore } from '../../store/uiStore'
import { useEditStore } from '../../store/editStore'
import { useHistoryStore } from '../../store/historyStore'
import { EditorIcon } from './editor-icon'

type EditorOptionsProps = { disabled: boolean }

export const EditorOptions: FC<EditorOptionsProps> = ({ disabled }) => {
    const tool = useUiStore((state) => state.drawerTool)
    const size = useUiStore((state) => state.drawerSize)
    const opacity = useUiStore((state) => state.drawerOpacity)
    const fill = useUiStore((state) => state.drawerFill)
    const selection = useUiStore((state) => state.drawerSelection)
    const imageId = useEditStore((state) => state.imageId)
    const canUndo = useHistoryStore((state) => state.canUndo(imageId))
    const canRedo = useHistoryStore((state) => state.canRedo(imageId))
    const { t } = useTranslation()
    const hasSize = !['move', 'hand', 'lasso', 'fill'].includes(tool)
    const hasOpacity = ['brush', 'pencil', 'eraser'].includes(tool)
    const hasFill = tool === 'rect' || tool === 'ellipse'

    return (
        <div className='flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-800 bg-neutral-900 px-4 py-2 text-xs text-neutral-300'>
            <span className='flex w-24 items-center gap-2 font-medium text-neutral-100'>
                <EditorIcon tool={tool} />
                {t(`panel.drawer.tool.${tool}`)}
            </span>
            <fieldset disabled={disabled} className='flex min-w-0 flex-1 flex-wrap items-center gap-4 disabled:opacity-40'>
                {hasSize && (
                    <label className='flex items-center gap-2'>
                        {t('panel.drawer.size')}
                        <input
                            type='range'
                            min={EDITOR_SIZE.min}
                            max={EDITOR_SIZE.max}
                            step={EDITOR_SIZE.step}
                            value={size}
                            onChange={(event) => useUiStore.getState().setDrawerSize(Number(event.target.value))}
                            className='w-24 accent-sky-400'
                        />
                        <span className='w-12 tabular-nums text-neutral-400'>{size.toFixed(1)}%</span>
                    </label>
                )}
                {hasOpacity && (
                    <label className='flex items-center gap-2'>
                        {t('editor.opacity')}
                        <input
                            type='range'
                            min={0}
                            max={EDITOR_PERCENT}
                            value={opacity}
                            onChange={(event) => useUiStore.getState().setDrawerOpacity(Number(event.target.value))}
                            className='w-20 accent-sky-400'
                        />
                        <span className='w-9 tabular-nums text-neutral-400'>{opacity}%</span>
                    </label>
                )}
                {hasFill && (
                    <label className='flex items-center gap-2'>
                        <input type='checkbox' checked={fill} onChange={(event) => useUiStore.getState().setDrawerFill(event.target.checked)} />
                        {t('panel.drawer.fill')}
                    </label>
                )}
                {tool === 'clone' && <span className='text-neutral-500'>{t('panel.drawer.cloneHint')}</span>}
                {tool === 'lasso' && <span className='text-neutral-500'>{t('editor.lassoHint')}</span>}
                {tool === 'move' && <span className='text-neutral-500'>{t('editor.moveHint')}</span>}
                {tool === 'hand' && <span className='text-neutral-500'>{t('editor.handHint')}</span>}
                {selection && (
                    <button
                        type='button'
                        onClick={() => useUiStore.getState().setDrawerSelection(null)}
                        className='rounded bg-neutral-800 px-2 py-1 text-sky-200'>
                        {t('panel.drawer.clearSelection')}
                    </button>
                )}
            </fieldset>
            <div className='flex items-center gap-1 border-l border-neutral-700 pl-3'>
                <button
                    type='button'
                    disabled={disabled || !canUndo}
                    onClick={() => useHistoryStore.getState().undo()}
                    title={t('shortcut.editUndo')}
                    className='rounded px-2 py-1 text-neutral-300 hover:bg-neutral-800 disabled:opacity-30'>
                    {t('editor.undo')}
                </button>
                <button
                    type='button'
                    disabled={disabled || !canRedo}
                    onClick={() => useHistoryStore.getState().redo()}
                    title={t('shortcut.editRedo')}
                    className='rounded px-2 py-1 text-neutral-300 hover:bg-neutral-800 disabled:opacity-30'>
                    {t('editor.redo')}
                </button>
            </div>
        </div>
    )
}
