import { useState } from 'react'
import type { FC } from 'react'
import { HSL_BANDS } from '../../store/editDefaults'
import { useEditStore } from '../../store/editStore'
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

const BAND_LABEL: Record<HslBand, string> = {
    red: '빨강',
    orange: '주황',
    yellow: '노랑',
    green: '초록',
    aqua: '청록',
    blue: '파랑',
    purple: '보라',
    magenta: '자홍',
}

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`)

const ZERO: HslAdjust = { hue: 0, sat: 0, lum: 0 }

export const HslSection: FC = () => {
    const [band, setBand] = useState<HslBand>('red')
    const hsl = useEditStore((state) => state.state?.color.hsl)
    const bw = useEditStore((state) => state.state?.color.bw)
    const edit = useEditStore((state) => state.edit)

    if (!hsl || bw === undefined) return null

    const adjust = hsl[band] ?? ZERO

    const setChannel = (channel: keyof HslAdjust, label: string) => (value: number) =>
        edit(
            (draft) => {
                const current = draft.color.hsl[band] ?? { ...ZERO }
                current[channel] = value
                draft.color.hsl[band] = current
            },
            { coalesceKey: `hsl.${band}.${channel}`, label: `${BAND_LABEL[band]} ${label}` },
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
            title='HSL / 컬러'
            right={
                <label className='flex items-center gap-1 text-[10px] text-neutral-400'>
                    <input
                        type='checkbox'
                        checked={bw}
                        onChange={(event) => edit((draft) => void (draft.color.bw = event.target.checked), { label: '흑백 변환' })}
                    />
                    흑백
                </label>
            }>
            <div className='flex justify-between gap-1'>
                {HSL_BANDS.map((item) => (
                    <button
                        key={item}
                        type='button'
                        onClick={() => setBand(item)}
                        aria-label={BAND_LABEL[item]}
                        aria-pressed={band === item}
                        className={`h-6 flex-1 rounded ${band === item ? 'ring-2 ring-white' : 'ring-1 ring-neutral-700'}`}
                        style={{ backgroundColor: BAND_COLOR[item] }}
                    />
                ))}
            </div>
            <p className='text-xs font-medium text-neutral-300'>{BAND_LABEL[band]}</p>
            {bw ? (
                <>
                    <p className='text-[10px] text-neutral-500'>흑백 믹서: 밴드별 휘도만 조정합니다</p>
                    {channelSlider('lum', '휘도')}
                </>
            ) : (
                <>
                    {channelSlider('hue', '색상')}
                    {channelSlider('sat', '채도')}
                    {channelSlider('lum', '휘도')}
                </>
            )}
        </Section>
    )
}
