import type { FC } from 'react'
import { applyCropAspect, CROP_ASPECTS, swapCropAspect, toggleCropMode } from '../../store/crop'
import { DEFAULT_EDIT_STATE } from '../../store/editDefaults'
import { useEditStore } from '../../store/editStore'
import { useUiStore } from '../../store/uiStore'
import type { GeometryState } from '../../types/GeometryState'
import { Section } from './Section'
import { Slider } from './Slider'

type GeoNumericKey = Exclude<keyof GeometryState, 'rotate90' | 'flipH' | 'flipV'>

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`)

const OVERLAY_LABEL = { thirds: '3분할', golden: '황금비', diag: '대각선', none: '없음' }

export const CropGeometrySection: FC = () => {
    const geometry = useEditStore((state) => state.state?.geometry)
    const crop = useEditStore((state) => state.state?.crop)
    const cropEditMode = useUiStore((state) => state.cropEditMode)
    const cropOverlay = useUiStore((state) => state.cropOverlay)
    const edit = useEditStore((state) => state.edit)

    if (!geometry) return null

    const geoSlider = (key: GeoNumericKey, label: string, min: number, max: number, step: number, format?: (value: number) => string) => (
        <Slider
            key={key}
            label={label}
            value={geometry[key]}
            min={min}
            max={max}
            step={step}
            defaultValue={DEFAULT_EDIT_STATE.geometry[key]}
            coalesceKey={`geometry.${key}`}
            format={format}
            onChange={(value) => edit((draft) => void (draft.geometry[key] = value), { coalesceKey: `geometry.${key}`, label })}
        />
    )

    const rotate = (delta: number) =>
        edit((draft) => void (draft.geometry.rotate90 = (((draft.geometry.rotate90 + delta) % 4) + 4) % 4), { label: '회전' })

    return (
        <Section id='crop' title='크롭 · 기하'>
            <button
                type='button'
                onClick={toggleCropMode}
                className={`rounded py-1.5 text-xs font-medium ${cropEditMode ? 'bg-neutral-200 text-neutral-900' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}>
                {cropEditMode ? '크롭 완료 (C)' : '크롭 (C)'}
            </button>
            <div className='flex items-center gap-2'>
                <select
                    value={crop?.aspect ?? 'original'}
                    onChange={(event) => applyCropAspect(event.target.value)}
                    aria-label='크롭 비율'
                    className='flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 outline-none'>
                    {CROP_ASPECTS.map((aspect) => (
                        <option key={aspect} value={aspect}>
                            {aspect === 'original' ? '원본' : aspect === 'free' ? '자유' : aspect}
                        </option>
                    ))}
                </select>
                <button
                    type='button'
                    onClick={swapCropAspect}
                    aria-label='가로세로 전환'
                    className='rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700'>
                    ⇄
                </button>
                <button
                    type='button'
                    onClick={() => useUiStore.getState().cycleCropOverlay()}
                    aria-label='오버레이 순환'
                    className='rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700'>
                    {OVERLAY_LABEL[cropOverlay]}
                </button>
            </div>
            <div className='flex items-center gap-2'>
                <span className='text-xs text-neutral-400'>회전</span>
                <button
                    type='button'
                    onClick={() => rotate(-1)}
                    aria-label='왼쪽 90도'
                    className='rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700'>
                    ↺
                </button>
                <button
                    type='button'
                    onClick={() => rotate(1)}
                    aria-label='오른쪽 90도'
                    className='rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700'>
                    ↻
                </button>
                <label className='ml-2 flex items-center gap-1 text-xs text-neutral-300'>
                    <input
                        type='checkbox'
                        checked={geometry.flipH}
                        onChange={(event) => edit((draft) => void (draft.geometry.flipH = event.target.checked), { label: '좌우 반전' })}
                    />
                    좌우
                </label>
                <label className='flex items-center gap-1 text-xs text-neutral-300'>
                    <input
                        type='checkbox'
                        checked={geometry.flipV}
                        onChange={(event) => edit((draft) => void (draft.geometry.flipV = event.target.checked), { label: '상하 반전' })}
                    />
                    상하
                </label>
            </div>
            {geoSlider('straighten', '수평 보정', -45, 45, 0.1, (value) => `${signed(value)}°`)}
            <p className='mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>변형</p>
            {geoSlider('perspectiveV', '수직 원근', -100, 100, 1, signed)}
            {geoSlider('perspectiveH', '수평 원근', -100, 100, 1, signed)}
            {geoSlider('perspectiveRotate', '회전', -100, 100, 1, signed)}
            {geoSlider('aspectAdjust', '종횡비', -100, 100, 1, signed)}
            {geoSlider('scale', '배율', 50, 200, 1)}
            {geoSlider('offsetX', 'X 오프셋', -100, 100, 1, signed)}
            {geoSlider('offsetY', 'Y 오프셋', -100, 100, 1, signed)}
        </Section>
    )
}
