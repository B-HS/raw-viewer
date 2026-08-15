import { Fragment, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Histogram } from '../Histogram'
import { useEditStore } from '../../store/editStore'
import { BasicSection } from './BasicSection'
import { CropGeometrySection } from './CropGeometrySection'
import { DetailSection } from './DetailSection'
import { DrawerSection } from './DrawerSection'
import { EffectsSection } from './EffectsSection'
import { HslSection } from './HslSection'
import { LensSection } from './LensSection'
import { ToneCurve } from './ToneCurve'

const SECTION_LABEL_KEYS: readonly (readonly [string, readonly string[]])[] = [
    [
        'basic',
        [
            'panel.basic.title',
            'panel.basic.exposure',
            'panel.basic.contrast',
            'panel.basic.highlights',
            'panel.basic.shadows',
            'panel.basic.whites',
            'panel.basic.blacks',
            'panel.basic.highlightRecovery',
            'panel.basic.temp',
            'panel.basic.tempShift',
            'panel.basic.tint',
            'panel.basic.vibrance',
            'panel.basic.saturation',
        ],
    ],
    ['tone', ['panel.tone.title', 'panel.tone.base']],
    ['hsl', ['panel.hsl.title', 'panel.hsl.hue', 'panel.hsl.sat', 'panel.hsl.lum', 'panel.hsl.bw', 'panel.hsl.tat']],
    [
        'detail',
        [
            'panel.detail.title',
            'panel.detail.sharpen',
            'panel.detail.amount',
            'panel.detail.radius',
            'panel.detail.detail',
            'panel.detail.masking',
            'panel.detail.noiseReduction',
            'panel.detail.nrLuminance',
            'panel.detail.nrLumaDetail',
            'panel.detail.nrLumaContrast',
            'panel.detail.nrColor',
            'panel.detail.nrColorDetail',
            'panel.detail.hotPixel',
        ],
    ],
    [
        'lens',
        [
            'panel.lens.title',
            'panel.lens.auto',
            'panel.lens.distortion',
            'panel.lens.tca',
            'panel.lens.vignette',
            'panel.lens.strength',
            'panel.lens.manualDistortion',
            'panel.lens.manualVignette',
        ],
    ],
    [
        'effects',
        [
            'panel.effects.title',
            'panel.effects.clarity',
            'panel.effects.dehaze',
            'panel.effects.vignette',
            'panel.effects.amount',
            'panel.effects.midpoint',
            'panel.effects.roundness',
            'panel.effects.feather',
            'panel.effects.grain',
            'panel.effects.size',
            'panel.effects.roughness',
        ],
    ],
    [
        'crop',
        [
            'panel.crop.title',
            'panel.crop.enter',
            'panel.crop.rotate',
            'panel.crop.straighten',
            'panel.crop.transform',
            'panel.crop.perspectiveV',
            'panel.crop.perspectiveH',
            'panel.crop.perspectiveRotate',
            'panel.crop.aspectAdjust',
            'panel.crop.scale',
            'panel.crop.offsetX',
            'panel.crop.offsetY',
            'panel.crop.flipH',
            'panel.crop.flipV',
        ],
    ],
    [
        'drawer',
        [
            'panel.drawer.title',
            'panel.drawer.enter',
            'panel.drawer.tool.brush',
            'panel.drawer.tool.pencil',
            'panel.drawer.tool.eraser',
            'panel.drawer.tool.text',
            'panel.drawer.layers',
        ],
    ],
]

const SECTION_COMPONENTS: Record<string, FC> = {
    basic: BasicSection,
    tone: ToneCurve,
    hsl: HslSection,
    detail: DetailSection,
    lens: LensSection,
    effects: EffectsSection,
    crop: CropGeometrySection,
    drawer: DrawerSection,
}

export const EditPanel: FC = () => {
    const [query, setQuery] = useState('')
    const { t } = useTranslation()
    const hasState = useEditStore((state) => state.state !== null)
    const edited = useEditStore((state) => state.dirtyFromDefault)

    const trimmed = query.trim().toLowerCase()
    const visibleSections = trimmed
        ? SECTION_LABEL_KEYS.filter(([, keys]) => keys.some((key) => t(key).toLowerCase().includes(trimmed)))
        : SECTION_LABEL_KEYS

    return (
        <aside className='flex h-full w-80 flex-col border-l border-neutral-800 bg-neutral-900 text-neutral-200'>
            <Histogram />
            <div className='flex items-center justify-between border-b border-neutral-800 px-3 py-2'>
                <span className='flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400'>
                    {t('panel.adjust')}
                    {edited && <span className='h-1.5 w-1.5 rounded-full bg-amber-400' title={t('common.edited')} />}
                </span>
                <button
                    type='button'
                    onClick={() => useEditStore.getState().resetAll()}
                    className='rounded px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100'>
                    {t('panel.resetAll')}
                </button>
            </div>
            {hasState ? (
                <>
                    <div className='border-b border-neutral-800 px-3 py-1.5'>
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t('panel.searchPlaceholder')}
                            aria-label={t('panel.searchPlaceholder')}
                            spellCheck={false}
                            className='w-full rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-neutral-500'
                        />
                    </div>
                    <div className='min-h-0 flex-1 overflow-y-auto'>
                        {visibleSections.length === 0 ? (
                            <div className='px-4 py-6 text-center text-xs text-neutral-500'>{t('panel.searchNoResults')}</div>
                        ) : (
                            visibleSections.map(([id]) => {
                                const SectionComponent = SECTION_COMPONENTS[id]
                                return (
                                    <Fragment key={`${id}-${trimmed ? 'search' : 'all'}`}>
                                        <SectionComponent />
                                    </Fragment>
                                )
                            })
                        )}
                    </div>
                </>
            ) : (
                <div className='flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-500'>{t('common.selectImage')}</div>
            )}
        </aside>
    )
}
