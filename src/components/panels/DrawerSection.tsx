import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
    addDrawerLayer,
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
import type { DrawerToolId } from '../../store/uiStore'
import type { DrawerAdjust } from '../../types/DrawerAdjust'
import type { DrawerBlendMode } from '../../types/DrawerBlendMode'
import type { DrawerTransform } from '../../types/DrawerTransform'
import { Section } from './Section'
import { Slider } from './Slider'

const TOOLS: DrawerToolId[] = ['brush', 'pencil', 'eraser', 'fill', 'line', 'arrow', 'rect', 'ellipse', 'text', 'move', 'lasso', 'clone', 'blur']

const BLEND_MODES: DrawerBlendMode[] = ['normal', 'multiply', 'screen', 'overlay']

const SIZE_MIN = 0.2

const SIZE_MAX = 20

export const DrawerSection: FC = () => {
    const { t } = useTranslation()
    const drawer = useEditStore((state) => state.state?.drawer)
    const hasState = useEditStore((state) => state.state !== null)
    const drawerEditMode = useUiStore((state) => state.drawerEditMode)
    const tool = useUiStore((state) => state.drawerTool)
    const color = useUiStore((state) => state.drawerColor)
    const size = useUiStore((state) => state.drawerSize)
    const fill = useUiStore((state) => state.drawerFill)
    const activeLayerId = useUiStore((state) => state.drawerActiveLayerId)
    const selection = useUiStore((state) => state.drawerSelection)

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
        <Section id='drawer' title={t('panel.drawer.title')}>
            <button
                type='button'
                onClick={() => useUiStore.getState().setDrawerEditMode(!drawerEditMode)}
                className={`rounded py-1.5 text-xs font-medium ${drawerEditMode ? 'bg-neutral-200 text-neutral-900' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}>
                {drawerEditMode ? t('panel.drawer.done') : t('panel.drawer.enter')}
            </button>
            <div className='grid grid-cols-4 gap-1'>
                {TOOLS.map((id) => (
                    <button
                        key={id}
                        type='button'
                        onClick={() => useUiStore.getState().setDrawerTool(id)}
                        className={`rounded px-1 py-1 text-[11px] ${tool === id ? 'bg-sky-500/30 text-sky-200' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>
                        {t(`panel.drawer.tool.${id}`)}
                    </button>
                ))}
            </div>
            {tool === 'clone' && <p className='text-[10px] text-neutral-500'>{t('panel.drawer.cloneHint')}</p>}
            {selection && (
                <button
                    type='button'
                    onClick={() => useUiStore.getState().setDrawerSelection(null)}
                    className='rounded bg-neutral-800 py-1 text-[11px] text-sky-300 hover:bg-neutral-700'>
                    {t('panel.drawer.clearSelection')}
                </button>
            )}
            <div className='flex items-center gap-2'>
                <input
                    type='color'
                    value={color}
                    onChange={(event) => useUiStore.getState().setDrawerColor(event.target.value)}
                    aria-label={t('panel.drawer.color')}
                    className='h-6 w-8 cursor-pointer rounded bg-neutral-800'
                />
                <input
                    type='range'
                    min={SIZE_MIN}
                    max={SIZE_MAX}
                    step={0.1}
                    value={size}
                    onChange={(event) => useUiStore.getState().setDrawerSize(Number(event.target.value))}
                    aria-label={t('panel.drawer.size')}
                    className='flex-1'
                />
                <span className='w-9 text-right text-[10px] tabular-nums text-neutral-400'>{size.toFixed(1)}%</span>
                <label className='flex items-center gap-1 text-xs text-neutral-300'>
                    <input type='checkbox' checked={fill} onChange={(event) => useUiStore.getState().setDrawerFill(event.target.checked)} />
                    {t('panel.drawer.fill')}
                </label>
            </div>
            <div className='flex items-center justify-between'>
                <span className='text-[10px] font-semibold uppercase tracking-wide text-neutral-500'>{t('panel.drawer.layers')}</span>
                <button
                    type='button'
                    onClick={addDrawerLayer}
                    className='rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-200 hover:bg-neutral-700'>
                    {t('panel.drawer.addLayer')}
                </button>
            </div>
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
                        onClick={() => useUiStore.getState().setDrawerActiveLayer(layer.id)}
                        className='flex-1 truncate text-left text-xs text-neutral-200'>
                        {layer.name}
                    </button>
                    <input
                        type='range'
                        min={0}
                        max={100}
                        step={1}
                        value={layer.opacity}
                        onChange={(event) => setDrawerLayerOpacity(layer.id, Number(event.target.value))}
                        aria-label={t('panel.drawer.opacityAria', { name: layer.name })}
                        className='w-14'
                    />
                    <button
                        type='button'
                        onClick={() => moveDrawerLayer(layer.id, 1)}
                        title={t('panel.drawer.layerUpAria')}
                        aria-label={t('panel.drawer.layerUpAria')}
                        className='rounded px-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100'>
                        ↑
                    </button>
                    <button
                        type='button'
                        onClick={() => moveDrawerLayer(layer.id, -1)}
                        title={t('panel.drawer.layerDownAria')}
                        aria-label={t('panel.drawer.layerDownAria')}
                        className='rounded px-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100'>
                        ↓
                    </button>
                    <button
                        type='button'
                        onClick={() => removeDrawerLayer(layer.id)}
                        title={t('panel.drawer.layerDeleteAria')}
                        aria-label={t('panel.drawer.layerDeleteAria')}
                        className='rounded px-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-red-300'>
                        ✕
                    </button>
                </div>
            ))}
            {activeLayer && (
                <>
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
        </Section>
    )
}
