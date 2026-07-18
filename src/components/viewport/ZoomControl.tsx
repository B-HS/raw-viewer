import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { zoomRatio } from '../../gl/viewTransform'
import { usePlaylist } from '../../store/playlist'
import { requestZoom } from '../../store/viewportCommand'
import { useViewportProjection } from '../../store/viewportProjection'

const ZOOM_SLIDER_MIN_PERCENT = 5
const ZOOM_SLIDER_MAX_PERCENT = 200

export const ZoomControl: FC = () => {
    const { t } = useTranslation()
    const model = useViewportProjection((state) => state.model)
    const clientW = useViewportProjection((state) => state.clientW)
    const clientH = useViewportProjection((state) => state.clientH)
    const level = usePlaylist((state) => {
        const current = state.entries[state.currentIndex]
        return current ? state.best[current.imageId] : undefined
    })

    if (!model || !level) return null

    const percent = Math.round(zoomRatio(model, clientW, clientH, level.width) * 100)
    const sliderValue = Math.min(ZOOM_SLIDER_MAX_PERCENT, Math.max(ZOOM_SLIDER_MIN_PERCENT, percent))

    return (
        <div className='pointer-events-auto flex items-center gap-1.5'>
            <input
                type='range'
                min={ZOOM_SLIDER_MIN_PERCENT}
                max={ZOOM_SLIDER_MAX_PERCENT}
                step={1}
                value={sliderValue}
                onChange={(event) => requestZoom({ ratio: Number(event.target.value) / 100 })}
                aria-label={t('viewport.zoomSlider')}
                title={t('viewport.zoomSlider')}
                className='w-24 accent-neutral-300'
            />
            <span className='w-10 text-right tabular-nums'>{percent}%</span>
        </div>
    )
}
