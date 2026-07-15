import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_EDIT_STATE } from '../../store/editDefaults'
import { useEditStore } from '../../store/editStore'
import type { EffectsState } from '../../types/EffectsState'
import { Section } from './Section'
import { Slider } from './Slider'

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`)

export const EffectsSection: FC = () => {
    const { t } = useTranslation()
    const effects = useEditStore((state) => state.state?.effects)
    const edit = useEditStore((state) => state.edit)

    if (!effects) return null

    const slider = (key: keyof EffectsState, label: string, min: number, max: number, step: number, format?: (value: number) => string) => (
        <Slider
            key={key}
            label={label}
            value={effects[key]}
            min={min}
            max={max}
            step={step}
            defaultValue={DEFAULT_EDIT_STATE.effects[key]}
            coalesceKey={`effects.${key}`}
            format={format}
            onChange={(value) => edit((draft) => void (draft.effects[key] = value), { coalesceKey: `effects.${key}`, label })}
        />
    )

    return (
        <Section id='effects' title={t('panel.effects.title')}>
            {slider('clarity', t('panel.effects.clarity'), -100, 100, 1, signed)}
            {slider('dehaze', t('panel.effects.dehaze'), -100, 100, 1, signed)}
            <p className='mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>{t('panel.effects.vignette')}</p>
            {slider('vignetteAmount', t('panel.effects.amount'), -100, 100, 1, signed)}
            {slider('vignetteMidpoint', t('panel.effects.midpoint'), 0, 100, 1)}
            {slider('vignetteRoundness', t('panel.effects.roundness'), -100, 100, 1, signed)}
            {slider('vignetteFeather', t('panel.effects.feather'), 0, 100, 1)}
            <p className='mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>{t('panel.effects.grain')}</p>
            {slider('grainAmount', t('panel.effects.amount'), 0, 100, 1)}
            {slider('grainSize', t('panel.effects.size'), 0, 100, 1)}
            {slider('grainRoughness', t('panel.effects.roughness'), 0, 100, 1)}
        </Section>
    )
}
