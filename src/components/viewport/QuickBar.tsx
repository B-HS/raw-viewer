import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { toggleCropMode } from '../../store/crop'
import { useEditStore } from '../../store/editStore'
import { rotateBy, toggleFlipH, toggleFlipV } from '../../store/geometry'
import { useUiStore } from '../../store/uiStore'

export const QuickBar: FC = () => {
    const hasEditState = useEditStore((state) => state.state !== null)
    const flipH = useEditStore((state) => state.state?.geometry.flipH ?? false)
    const flipV = useEditStore((state) => state.state?.geometry.flipV ?? false)
    const cropEditMode = useUiStore((state) => state.cropEditMode)

    const buttonClass = (active: boolean) =>
        `pointer-events-auto flex h-6 w-6 items-center justify-center rounded text-sm leading-none disabled:cursor-default disabled:opacity-40 ${active ? 'bg-sky-500/30 text-sky-300' : 'text-neutral-300 enabled:hover:bg-neutral-700/70 enabled:hover:text-white'}`

    const { t } = useTranslation()

    return (
        <div className='pointer-events-none absolute bottom-3 left-3 flex items-center gap-0.5 rounded bg-black/60 p-1'>
            <button
                type='button'
                disabled={!hasEditState}
                onClick={() => rotateBy(-1)}
                title={t('quickbar.rotateLeft')}
                aria-label={t('quickbar.rotateLeft')}
                className={buttonClass(false)}>
                ↺
            </button>
            <button
                type='button'
                disabled={!hasEditState}
                onClick={() => rotateBy(1)}
                title={t('quickbar.rotateRight')}
                aria-label={t('quickbar.rotateRight')}
                className={buttonClass(false)}>
                ↻
            </button>
            <button
                type='button'
                disabled={!hasEditState}
                onClick={toggleFlipH}
                title={t('quickbar.flipH')}
                aria-label={t('quickbar.flipH')}
                className={buttonClass(flipH)}>
                <svg viewBox='0 0 16 16' width='12' height='12' fill='currentColor' stroke='none' aria-hidden='true'>
                    <path d='M8 1v14' fill='none' stroke='currentColor' strokeWidth='1' strokeDasharray='2 1.5' />
                    <path d='M6 4 1 8l5 4z' />
                    <path d='M10 4l5 4-5 4z' fill='none' stroke='currentColor' strokeWidth='1.2' />
                </svg>
            </button>
            <button
                type='button'
                disabled={!hasEditState}
                onClick={toggleFlipV}
                title={t('quickbar.flipV')}
                aria-label={t('quickbar.flipV')}
                className={buttonClass(flipV)}>
                <svg viewBox='0 0 16 16' width='12' height='12' fill='currentColor' stroke='none' aria-hidden='true'>
                    <path d='M1 8h14' fill='none' stroke='currentColor' strokeWidth='1' strokeDasharray='2 1.5' />
                    <path d='M4 6 8 1l4 5z' />
                    <path d='M4 10l4 5 4-5z' fill='none' stroke='currentColor' strokeWidth='1.2' />
                </svg>
            </button>
            <button
                type='button'
                disabled={!hasEditState}
                onClick={toggleCropMode}
                title={t('quickbar.crop')}
                aria-label={t('quickbar.crop')}
                className={buttonClass(cropEditMode)}>
                <svg viewBox='0 0 16 16' width='12' height='12' fill='none' stroke='currentColor' strokeWidth='1.5' aria-hidden='true'>
                    <path d='M4 1v11h11' />
                    <path d='M1 4h11v11' />
                </svg>
            </button>
        </div>
    )
}
