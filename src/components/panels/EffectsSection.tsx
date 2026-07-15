import type { FC } from 'react'
import { DEFAULT_EDIT_STATE } from '../../store/editDefaults'
import { useEditStore } from '../../store/editStore'
import type { EffectsState } from '../../types/EffectsState'
import { Section } from './Section'
import { Slider } from './Slider'

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`)

export const EffectsSection: FC = () => {
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
        <Section id='effects' title='효과'>
            {slider('clarity', '부분 대비', -100, 100, 1, signed)}
            {slider('dehaze', '헤이즈 제거', -100, 100, 1, signed)}
            <p className='mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>비네팅</p>
            {slider('vignetteAmount', '양', -100, 100, 1, signed)}
            {slider('vignetteMidpoint', '중간점', 0, 100, 1)}
            {slider('vignetteRoundness', '둥글기', -100, 100, 1, signed)}
            {slider('vignetteFeather', '페더', 0, 100, 1)}
            <p className='mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>그레인</p>
            {slider('grainAmount', '양', 0, 100, 1)}
            {slider('grainSize', '크기', 0, 100, 1)}
            {slider('grainRoughness', '거칠기', 0, 100, 1)}
        </Section>
    )
}
