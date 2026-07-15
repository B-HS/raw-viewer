import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_EDIT_STATE } from '../../store/editDefaults'
import { useEditStore } from '../../store/editStore'
import type { DetailState } from '../../types/DetailState'
import { Section } from './Section'
import { Slider } from './Slider'

type DetailNumericKey = Exclude<keyof DetailState, 'hotPixelRemoval'>

export const DetailSection: FC = () => {
    const { t } = useTranslation()
    const detail = useEditStore((state) => state.state?.detail)
    const isRaw = useEditStore((state) => state.isRaw)
    const edit = useEditStore((state) => state.edit)

    if (!detail) return null

    const slider = (key: DetailNumericKey, label: string, min: number, max: number, step: number) => (
        <Slider
            key={key}
            label={label}
            value={detail[key]}
            min={min}
            max={max}
            step={step}
            defaultValue={DEFAULT_EDIT_STATE.detail[key]}
            coalesceKey={`detail.${key}`}
            onChange={(value) => edit((draft) => void (draft.detail[key] = value), { coalesceKey: `detail.${key}`, label })}
        />
    )

    return (
        <Section id='detail' title={t('panel.detail.title')}>
            <p className='text-[10px] text-neutral-500'>{t('panel.detail.zoomHint')}</p>
            <p className='text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>{t('panel.detail.sharpen')}</p>
            {slider('sharpenAmount', t('panel.detail.amount'), 0, 150, 1)}
            {slider('sharpenRadius', t('panel.detail.radius'), 0.5, 3, 0.1)}
            {slider('sharpenDetail', t('panel.detail.detail'), 0, 100, 1)}
            {slider('sharpenMasking', t('panel.detail.masking'), 0, 100, 1)}
            <p className='mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>{t('panel.detail.noiseReduction')}</p>
            {slider('nrLuminance', t('panel.detail.nrLuminance'), 0, 100, 1)}
            {slider('nrLumaDetail', t('panel.detail.nrLumaDetail'), 0, 100, 1)}
            {slider('nrLumaContrast', t('panel.detail.nrLumaContrast'), 0, 100, 1)}
            {slider('nrColor', t('panel.detail.nrColor'), 0, 100, 1)}
            {slider('nrColorDetail', t('panel.detail.nrColorDetail'), 0, 100, 1)}
            <label className={`mt-1 flex items-center gap-2 text-xs text-neutral-300 ${isRaw ? '' : 'opacity-40'}`}>
                <input
                    type='checkbox'
                    checked={detail.hotPixelRemoval}
                    disabled={!isRaw}
                    onChange={(event) =>
                        edit((draft) => void (draft.detail.hotPixelRemoval = event.target.checked), { label: t('panel.detail.hotPixel') })
                    }
                />
                {t('panel.detail.hotPixel')}
            </label>
        </Section>
    )
}
