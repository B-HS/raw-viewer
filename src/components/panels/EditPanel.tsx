import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Histogram } from '../Histogram'
import { useEditStore } from '../../store/editStore'
import { BasicSection } from './BasicSection'
import { CropGeometrySection } from './CropGeometrySection'
import { DetailSection } from './DetailSection'
import { EffectsSection } from './EffectsSection'
import { HslSection } from './HslSection'
import { ToneCurve } from './ToneCurve'

export const EditPanel: FC = () => {
    const { t } = useTranslation()
    const hasState = useEditStore((state) => state.state !== null)
    const edited = useEditStore((state) => state.dirtyFromDefault)

    return (
        <aside className='flex h-full w-80 flex-col border-l border-neutral-800 bg-neutral-900 text-neutral-200'>
            <Histogram />
            <div className='flex items-center justify-between border-b border-neutral-800 px-3 py-2'>
                <span className='flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400'>
                    {t('panel.adjust')}
                    {edited && <span className='h-1.5 w-1.5 rounded-full bg-amber-400' title={t('common.edited')} />}
                </span>
                <button
                    type='button'
                    onClick={() => useEditStore.getState().resetAll()}
                    className='rounded px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'>
                    {t('panel.resetAll')}
                </button>
            </div>
            {hasState ? (
                <div className='min-h-0 flex-1 overflow-y-auto'>
                    <BasicSection />
                    <ToneCurve />
                    <HslSection />
                    <DetailSection />
                    <EffectsSection />
                    <CropGeometrySection />
                </div>
            ) : (
                <div className='flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-500'>{t('common.selectImage')}</div>
            )}
        </aside>
    )
}
