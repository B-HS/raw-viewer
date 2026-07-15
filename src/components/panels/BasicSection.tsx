import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_EDIT_STATE } from '../../store/editDefaults'
import { useEditStore } from '../../store/editStore'
import type { ToneState } from '../../types/ToneState'
import { Section } from './Section'
import { Slider } from './Slider'

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`)
const signedEv = (value: number) => (value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2))

export const BasicSection: FC = () => {
    const { t } = useTranslation()
    const wb = useEditStore((state) => state.state?.wb)
    const tone = useEditStore((state) => state.state?.tone)
    const vibrance = useEditStore((state) => state.state?.color.vibrance)
    const saturation = useEditStore((state) => state.state?.color.saturation)
    const isRaw = useEditStore((state) => state.isRaw)
    const edit = useEditStore((state) => state.edit)

    if (!wb || !tone || vibrance === undefined || saturation === undefined) return null

    const toneSlider = (key: keyof ToneState, label: string, min: number, max: number, step: number, format?: (value: number) => string) => (
        <Slider
            key={key}
            label={label}
            value={tone[key]}
            min={min}
            max={max}
            step={step}
            defaultValue={DEFAULT_EDIT_STATE.tone[key]}
            coalesceKey={`tone.${key}`}
            format={format}
            onChange={(value) => edit((draft) => void (draft.tone[key] = value), { coalesceKey: `tone.${key}`, label })}
        />
    )

    return (
        <Section id='basic' title={t('panel.basic.title')}>
            {isRaw ? (
                <>
                    <Slider
                        label={t('panel.basic.temp')}
                        value={wb.temp}
                        min={2000}
                        max={50000}
                        step={50}
                        defaultValue={DEFAULT_EDIT_STATE.wb.temp}
                        coalesceKey='wb.temp'
                        format={(value) => `${Math.round(value)}K`}
                        onChange={(value) => edit((draft) => void (draft.wb.temp = value), { coalesceKey: 'wb.temp', label: t('panel.basic.temp') })}
                    />
                    <Slider
                        label={t('panel.basic.tint')}
                        value={wb.tint}
                        min={-150}
                        max={150}
                        step={1}
                        defaultValue={DEFAULT_EDIT_STATE.wb.tint}
                        coalesceKey='wb.tint'
                        format={signed}
                        onChange={(value) => edit((draft) => void (draft.wb.tint = value), { coalesceKey: 'wb.tint', label: t('panel.basic.tint') })}
                    />
                </>
            ) : (
                <Slider
                    label={t('panel.basic.tempShift')}
                    value={wb.tempShift ?? 0}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    coalesceKey='wb.tempShift'
                    format={signed}
                    onChange={(value) =>
                        edit((draft) => void (draft.wb.tempShift = value), { coalesceKey: 'wb.tempShift', label: t('panel.basic.tempShift') })
                    }
                />
            )}
            {toneSlider('exposure', t('panel.basic.exposure'), -5, 5, 0.05, signedEv)}
            {toneSlider('contrast', t('panel.basic.contrast'), -100, 100, 1, signed)}
            {toneSlider('highlights', t('panel.basic.highlights'), -100, 100, 1, signed)}
            {toneSlider('shadows', t('panel.basic.shadows'), -100, 100, 1, signed)}
            {toneSlider('whites', t('panel.basic.whites'), -100, 100, 1, signed)}
            {toneSlider('blacks', t('panel.basic.blacks'), -100, 100, 1, signed)}
            {toneSlider('highlightRecovery', t('panel.basic.highlightRecovery'), 0, 100, 1)}
            <div className='mt-1 border-t border-neutral-800 pt-2' />
            <Slider
                label={t('panel.basic.vibrance')}
                value={vibrance}
                min={-100}
                max={100}
                step={1}
                defaultValue={0}
                coalesceKey='color.vibrance'
                format={signed}
                onChange={(value) =>
                    edit((draft) => void (draft.color.vibrance = value), { coalesceKey: 'color.vibrance', label: t('panel.basic.vibrance') })
                }
            />
            <Slider
                label={t('panel.basic.saturation')}
                value={saturation}
                min={-100}
                max={100}
                step={1}
                defaultValue={0}
                coalesceKey='color.saturation'
                format={signed}
                onChange={(value) =>
                    edit((draft) => void (draft.color.saturation = value), { coalesceKey: 'color.saturation', label: t('panel.basic.saturation') })
                }
            />
        </Section>
    )
}
