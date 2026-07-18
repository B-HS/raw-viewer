import { useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { HSL_BANDS } from '../../store/editDefaults'
import { useEditStore } from '../../store/editStore'
import { useUiStore } from '../../store/uiStore'
import type { HslAdjust } from '../../types/HslAdjust'
import type { HslBand } from '../../types/HslBand'
import { Section } from './Section'
import { Slider } from './Slider'

const BAND_COLOR: Record<HslBand, string> = {
    red: '#e05555',
    orange: '#e0913c',
    yellow: '#d8c93c',
    green: '#4fae5a',
    aqua: '#43b3b3',
    blue: '#5a7bff',
    purple: '#9a6bff',
    magenta: '#c76bd0',
}

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`)

const ZERO: HslAdjust = { hue: 0, sat: 0, lum: 0 }

export const HslSection: FC = () => {
    const { t } = useTranslation()
    const [band, setBand] = useState<HslBand>('red')
    const [prevTatBand, setPrevTatBand] = useState<HslBand | null>(null)
    const hsl = useEditStore((state) => state.state?.color.hsl)
    const bw = useEditStore((state) => state.state?.color.bw)
    const edit = useEditStore((state) => state.edit)
    const tatActive = useUiStore((state) => state.tatActive)
    const tatBand = useUiStore((state) => state.tatBand)

    if (tatBand !== prevTatBand) {
        setPrevTatBand(tatBand)
        if (tatBand) setBand(tatBand)
    }

    if (!hsl || bw === undefined) return null

    const bandLabel = (item: HslBand) => t(`panel.hsl.band.${item}`)
    const adjust = hsl[band] ?? ZERO

    const setChannel = (channel: keyof HslAdjust, label: string) => (value: number) =>
        edit(
            (draft) => {
                const current = draft.color.hsl[band] ?? { ...ZERO }
                current[channel] = value
                draft.color.hsl[band] = current
            },
            { coalesceKey: `hsl.${band}.${channel}`, label: t('history.bandChannel', { band: bandLabel(band), channel: label }) },
        )

    const channelSlider = (channel: keyof HslAdjust, label: string) => (
        <Slider
            key={channel}
            label={label}
            value={adjust[channel]}
            min={-100}
            max={100}
            step={1}
            defaultValue={0}
            coalesceKey={`hsl.${band}.${channel}`}
            format={signed}
            onChange={setChannel(channel, label)}
        />
    )

    return (
        <Section
            id='hsl'
            title={t('panel.hsl.title')}
            right={
                <div className='flex items-center gap-2'>
                    <button
                        type='button'
                        onClick={() => useUiStore.getState().toggleTat()}
                        aria-pressed={tatActive}
                        title={t('panel.hsl.tatHint')}
                        className={`rounded px-1.5 py-0.5 text-[10px] ${tatActive ? 'bg-white text-black' : 'bg-neutral-800 text-neutral-300 hover:text-neutral-100'}`}>
                        {t('panel.hsl.tat')}
                    </button>
                    <label className='flex items-center gap-1 text-[10px] text-neutral-400'>
                        <input
                            type='checkbox'
                            checked={bw}
                            onChange={(event) => edit((draft) => void (draft.color.bw = event.target.checked), { label: t('history.bwConvert') })}
                        />
                        {t('panel.hsl.bw')}
                    </label>
                </div>
            }>
            <div className='flex justify-between gap-1'>
                {HSL_BANDS.map((item) => (
                    <button
                        key={item}
                        type='button'
                        onClick={() => setBand(item)}
                        aria-label={bandLabel(item)}
                        aria-pressed={band === item}
                        className={`h-6 flex-1 rounded ${band === item ? 'ring-2 ring-white' : 'ring-1 ring-neutral-700'}`}
                        style={{ backgroundColor: BAND_COLOR[item] }}
                    />
                ))}
            </div>
            <p className='text-xs font-medium text-neutral-300'>{bandLabel(band)}</p>
            {tatActive && <p className='text-[10px] text-sky-300'>{t('panel.hsl.tatActive')}</p>}
            {bw ? (
                <>
                    <p className='text-[10px] text-neutral-500'>{t('panel.hsl.bwMixerHint')}</p>
                    {channelSlider('lum', t('panel.hsl.lum'))}
                </>
            ) : (
                <>
                    {channelSlider('hue', t('panel.hsl.hue'))}
                    {channelSlider('sat', t('panel.hsl.sat'))}
                    {channelSlider('lum', t('panel.hsl.lum'))}
                </>
            )}
        </Section>
    )
}
