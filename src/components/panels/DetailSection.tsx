import type { FC } from 'react'
import { DEFAULT_EDIT_STATE } from '../../store/editDefaults'
import { useEditStore } from '../../store/editStore'
import type { DetailState } from '../../types/DetailState'
import { Section } from './Section'
import { Slider } from './Slider'

type DetailNumericKey = Exclude<keyof DetailState, 'hotPixelRemoval'>

export const DetailSection: FC = () => {
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
        <Section id='detail' title='디테일'>
            <p className='text-[10px] text-neutral-500'>ⓘ 샤프닝/노이즈는 100% 줌에서 정확합니다</p>
            <p className='text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>샤프닝</p>
            {slider('sharpenAmount', '양', 0, 150, 1)}
            {slider('sharpenRadius', '반경', 0.5, 3, 0.1)}
            {slider('sharpenDetail', '디테일', 0, 100, 1)}
            {slider('sharpenMasking', '마스킹', 0, 100, 1)}
            <p className='mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>노이즈 감소</p>
            {slider('nrLuminance', '휘도', 0, 100, 1)}
            {slider('nrLumaDetail', '휘도 디테일', 0, 100, 1)}
            {slider('nrLumaContrast', '휘도 대비', 0, 100, 1)}
            {slider('nrColor', '색상', 0, 100, 1)}
            {slider('nrColorDetail', '색상 디테일', 0, 100, 1)}
            <label className={`mt-1 flex items-center gap-2 text-xs text-neutral-300 ${isRaw ? '' : 'opacity-40'}`}>
                <input
                    type='checkbox'
                    checked={detail.hotPixelRemoval}
                    disabled={!isRaw}
                    onChange={(event) => edit((draft) => void (draft.detail.hotPixelRemoval = event.target.checked), { label: '핫픽셀 제거' })}
                />
                핫픽셀 제거
            </label>
        </Section>
    )
}
