import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { applyCropAspect, CROP_ASPECTS, swapCropAspect, toggleCropMode } from '../../store/crop'
import { rotateBy, toggleFlipH, toggleFlipV } from '../../store/geometry'
import { DEFAULT_EDIT_STATE } from '../../store/editDefaults'
import { useEditStore } from '../../store/editStore'
import { useUiStore } from '../../store/uiStore'
import type { GeometryState } from '../../types/GeometryState'
import { Section } from './Section'
import { Slider } from './Slider'

type GeoNumericKey = Exclude<keyof GeometryState, 'rotate90' | 'flipH' | 'flipV'>

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`)

export const CropGeometrySection: FC = () => {
    const { t } = useTranslation()
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

    return (
        <Section id='crop' title={t('panel.crop.title')}>
            <button
                type='button'
                onClick={toggleCropMode}
                className={`rounded py-1.5 text-xs font-medium ${cropEditMode ? 'bg-neutral-200 text-neutral-900' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}>
                {cropEditMode ? t('panel.crop.done') : t('panel.crop.enter')}
            </button>
            <div className='flex items-center gap-2'>
                <select
                    value={crop?.aspect ?? 'original'}
                    onChange={(event) => applyCropAspect(event.target.value)}
                    aria-label={t('panel.crop.ratioAria')}
                    className='flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 outline-none'>
                    {CROP_ASPECTS.map((aspect) => (
                        <option key={aspect} value={aspect}>
                            {aspect === 'original' ? t('panel.crop.original') : aspect === 'free' ? t('panel.crop.free') : aspect}
                        </option>
                    ))}
                </select>
                <button
                    type='button'
                    onClick={swapCropAspect}
                    title={t('panel.crop.swapAria')}
                    aria-label={t('panel.crop.swapAria')}
                    className='rounded bg-neutral-800 px-2 py-1 text-sm leading-none text-neutral-200 hover:bg-neutral-700'>
                    ⇄
                </button>
                <button
                    type='button'
                    onClick={() => useUiStore.getState().cycleCropOverlay()}
                    title={t('panel.crop.overlayAria')}
                    aria-label={t('panel.crop.overlayAria')}
                    className='rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700'>
                    {t(`panel.crop.overlay.${cropOverlay}`)}
                </button>
            </div>
            <div className='flex items-center gap-2'>
                <span className='text-xs text-neutral-400'>{t('panel.crop.rotate')}</span>
                <button
                    type='button'
                    onClick={() => rotateBy(-1)}
                    title={t('panel.crop.rotateLeftAria')}
                    aria-label={t('panel.crop.rotateLeftAria')}
                    className='rounded bg-neutral-800 px-2 py-1 text-sm leading-none hover:bg-neutral-700'>
                    ↺
                </button>
                <button
                    type='button'
                    onClick={() => rotateBy(1)}
                    title={t('panel.crop.rotateRightAria')}
                    aria-label={t('panel.crop.rotateRightAria')}
                    className='rounded bg-neutral-800 px-2 py-1 text-sm leading-none hover:bg-neutral-700'>
                    ↻
                </button>
                <label className='ml-2 flex items-center gap-1 text-xs text-neutral-300'>
                    <input type='checkbox' checked={geometry.flipH} onChange={toggleFlipH} />
                    {t('panel.crop.flipH')}
                </label>
                <label className='flex items-center gap-1 text-xs text-neutral-300'>
                    <input type='checkbox' checked={geometry.flipV} onChange={toggleFlipV} />
                    {t('panel.crop.flipV')}
                </label>
            </div>
            {geoSlider('straighten', t('panel.crop.straighten'), -45, 45, 0.1, (value) => `${signed(value)}°`)}
            <p className='mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>{t('panel.crop.transform')}</p>
            {geoSlider('perspectiveV', t('panel.crop.perspectiveV'), -100, 100, 1, signed)}
            {geoSlider('perspectiveH', t('panel.crop.perspectiveH'), -100, 100, 1, signed)}
            {geoSlider('perspectiveRotate', t('panel.crop.perspectiveRotate'), -100, 100, 1, signed)}
            {geoSlider('aspectAdjust', t('panel.crop.aspectAdjust'), -100, 100, 1, signed)}
            {geoSlider('scale', t('panel.crop.scale'), 50, 200, 1)}
            {geoSlider('offsetX', t('panel.crop.offsetX'), -100, 100, 1, signed)}
            {geoSlider('offsetY', t('panel.crop.offsetY'), -100, 100, 1, signed)}
        </Section>
    )
}
