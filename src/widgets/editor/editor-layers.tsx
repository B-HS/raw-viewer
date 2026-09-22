import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
    addDrawerLayer,
    duplicateDrawerLayer,
    renameDrawerLayer,
    DEFAULT_DRAWER_ADJUST,
    DEFAULT_DRAWER_TRANSFORM,
    moveDrawerLayer,
    removeDrawerLayer,
    setDrawerLayerAdjust,
    setDrawerLayerBlend,
    setDrawerLayerOpacity,
    setDrawerLayerTransform,
    setDrawerLayerVisible,
} from '../../store/drawer'
import { useEditStore } from '../../store/editStore'
import { useUiStore } from '../../store/uiStore'
import type { DrawerAdjust } from '../../types/DrawerAdjust'
import type { DrawerBlendMode } from '../../types/DrawerBlendMode'
import type { DrawerTransform } from '../../types/DrawerTransform'
import { EDITOR_LAYER_NAME_MAX } from '../../shared/constants/editor'
import { Slider } from '../../components/panels/Slider'
import { LayerPreview } from './layer-preview'

const BLEND_MODES: DrawerBlendMode[] = ['normal', 'multiply', 'screen', 'overlay']

export const EditorLayers: FC = () => {
    const { t } = useTranslation()
    const drawer = useEditStore((state) => state.state?.drawer)
    const hasState = useEditStore((state) => state.state !== null)
    const activeLayerId = useUiStore((state) => state.drawerActiveLayerId)

    if (!hasState) return null

    const layers = drawer?.layers ?? []
    const topFirstLayers = [...layers].reverse()
    const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? layers.at(-1)
    const transform = activeLayer?.transform ?? DEFAULT_DRAWER_TRANSFORM
    const adjust = activeLayer?.adjust ?? DEFAULT_DRAWER_ADJUST

    const transformSlider = (key: keyof DrawerTransform, label: string, min: number, max: number, defaultValue: number) =>
        activeLayer && (
            <Slider
                key={key}
                label={label}
                value={transform[key]}
                min={min}
                max={max}
                step={1}
                defaultValue={defaultValue}
                coalesceKey={`drawer.transform.${activeLayer.id}`}
                onChange={(value) => setDrawerLayerTransform(activeLayer.id, { [key]: value })}
            />
        )

    const adjustSlider = (key: keyof DrawerAdjust, label: string, min: number, max: number) =>
        activeLayer && (
            <Slider
                key={key}
                label={label}
                value={adjust[key]}
                min={min}
                max={max}
                step={1}
                defaultValue={0}
                coalesceKey={`drawer.adjust.${activeLayer.id}`}
                onChange={(value) => setDrawerLayerAdjust(activeLayer.id, { [key]: value })}
            />
        )

    return (
        <div className='flex flex-col gap-3 p-3'>
            <div className='flex items-center justify-between'>
                <span className='text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>{t('panel.drawer.layers')}</span>
                <button
                    type='button'
                    onClick={addDrawerLayer}
                    className='rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-200 hover:bg-neutral-700'>
                    {t('panel.drawer.addLayer')}
                </button>
            </div>
            {layers.length === 0 && (
                <p className='rounded border border-dashed border-neutral-700 px-4 py-6 text-center text-xs leading-relaxed text-neutral-500'>
                    {t('editor.emptyLayers')}
                </p>
            )}
            {topFirstLayers.map((layer) => (
                <div
                    key={layer.id}
                    className={`flex items-center gap-1.5 rounded px-1.5 py-1 ${activeLayer?.id === layer.id ? 'bg-sky-500/15' : 'bg-neutral-800/60'}`}>
                    <input
                        type='checkbox'
                        checked={layer.visible}
                        onChange={(event) => setDrawerLayerVisible(layer.id, event.target.checked)}
                        aria-label={t('panel.drawer.layerVisibleAria', { name: layer.name })}
                    />
                    <button
                        type='button'
                        aria-pressed={activeLayer?.id === layer.id}
                        onClick={() => useUiStore.getState().setDrawerActiveLayer(layer.id)}
                        className='flex min-w-0 flex-1 items-center gap-2 text-left text-xs text-neutral-200'>
                        <LayerPreview layer={layer} />
                        <span className='truncate'>{layer.name}</span>
                    </button>
                    <input
                        type='range'
                        min={0}
                        max={100}
                        step={1}
                        value={layer.opacity}
                        onChange={(event) => setDrawerLayerOpacity(layer.id, Number(event.target.value))}
                        aria-label={t('panel.drawer.opacityAria', { name: layer.name })}
                        className='w-10 accent-sky-400'
                    />
                    <button
                        type='button'
                        disabled={layer.id === layers.at(-1)?.id}
                        onClick={() => moveDrawerLayer(layer.id, 1)}
                        title={t('panel.drawer.layerUpAria')}
                        aria-label={t('panel.drawer.layerUpAria')}
                        className='rounded px-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100'>
                        <svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' aria-hidden='true'>
                            <path d='m2 8 4-4 4 4' />
                        </svg>
                    </button>
                    <button
                        type='button'
                        disabled={layer.id === layers[0]?.id}
                        onClick={() => moveDrawerLayer(layer.id, -1)}
                        title={t('panel.drawer.layerDownAria')}
                        aria-label={t('panel.drawer.layerDownAria')}
                        className='rounded px-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100'>
                        <svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' aria-hidden='true'>
                            <path d='m2 4 4 4 4-4' />
                        </svg>
                    </button>
                    <button
                        type='button'
                        onClick={() => removeDrawerLayer(layer.id)}
                        title={t('panel.drawer.layerDeleteAria')}
                        aria-label={t('panel.drawer.layerDeleteAria')}
                        className='rounded px-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-red-300'>
                        <svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' aria-hidden='true'>
                            <path d='m3 3 6 6M9 3 3 9' />
                        </svg>
                    </button>
                </div>
            ))}
            <div className='flex items-center gap-2 rounded border border-neutral-800 bg-neutral-950/50 px-3 py-3 text-xs text-neutral-500'>
                <svg width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='currentColor' aria-hidden='true'>
                    <rect x='3' y='7' width='10' height='7' rx='1' />
                    <path d='M5 7V4a3 3 0 0 1 6 0v3' />
                </svg>
                {t('editor.original')}
            </div>
            {activeLayer && (
                <>
                    <label className='flex flex-col gap-1 text-[11px] text-neutral-500'>
                        {t('editor.layerName')}
                        <input
                            key={activeLayer.id + activeLayer.name}
                            defaultValue={activeLayer.name}
                            maxLength={EDITOR_LAYER_NAME_MAX}
                            onBlur={(event) => renameDrawerLayer(activeLayer.id, event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                            }}
                            className='rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-sky-400'
                        />
                    </label>
                    <button
                        type='button'
                        onClick={() => duplicateDrawerLayer(activeLayer.id)}
                        className='rounded border border-neutral-700 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800'>
                        {t('editor.duplicateLayer')}
                    </button>
                    <div className='flex items-center gap-2'>
                        <span className='text-xs text-neutral-400'>{t('panel.drawer.blend')}</span>
                        <select
                            value={activeLayer.blend}
                            onChange={(event) => {
                                const mode = BLEND_MODES.find((item) => item === event.target.value)
                                if (mode) setDrawerLayerBlend(activeLayer.id, mode)
                            }}
                            aria-label={t('panel.drawer.blend')}
                            className='flex-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 outline-none'>
                            {BLEND_MODES.map((mode) => (
                                <option key={mode} value={mode}>
                                    {t(`panel.drawer.blendMode.${mode}`)}
                                </option>
                            ))}
                        </select>
                    </div>
                    <p className='mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>{t('panel.drawer.placementHeading')}</p>
                    {transformSlider('offsetX', t('panel.drawer.transformX'), -100, 100, 0)}
                    {transformSlider('offsetY', t('panel.drawer.transformY'), -100, 100, 0)}
                    {transformSlider('scale', t('panel.drawer.transformScale'), 10, 400, 100)}
                    {transformSlider('rotate', t('panel.drawer.transformRotate'), -180, 180, 0)}
                    <p className='mt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>{t('panel.drawer.adjustHeading')}</p>
                    {adjustSlider('brightness', t('panel.drawer.adjustBrightness'), -100, 100)}
                    {adjustSlider('contrast', t('panel.drawer.adjustContrast'), -100, 100)}
                    {adjustSlider('saturation', t('panel.drawer.adjustSaturation'), -100, 100)}
                    {adjustSlider('hue', t('panel.drawer.adjustHue'), -180, 180)}
                </>
            )}
        </div>
    )
}
