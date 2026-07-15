import { useRef } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditStore } from '../../store/editStore'
import { useHistoryStore } from '../../store/historyStore'
import { useUiStore } from '../../store/uiStore'
import type { HslBand } from '../../types/HslBand'
import { hueDegrees, nearestBand } from './sampling'

const SENSITIVITY = 0.5

const clampAdjust = (value: number) => Math.max(-100, Math.min(100, Math.round(value)))

type Drag = { band: HslBand; x: number; y: number; base: { hue: number; sat: number; lum: number } }

export const TatOverlay: FC = () => {
    const { t } = useTranslation()
    const dragRef = useRef<Drag | null>(null)

    const bandLabel = (band: HslBand) => t(`panel.hsl.band.${band}`)

    const onPointerDown = (event: React.PointerEvent) => {
        if (event.button !== 0) return
        const engine = useUiStore.getState().engine
        if (!engine) return
        const rect = event.currentTarget.getBoundingClientRect()
        const sample = engine.samplePixel(event.clientX - rect.left, event.clientY - rect.top)
        if (!sample) return
        const band = nearestBand(hueDegrees(sample.r, sample.g, sample.b))
        const state = useEditStore.getState().state
        if (!state) return
        const current = state.color.hsl[band] ?? { hue: 0, sat: 0, lum: 0 }
        dragRef.current = { band, x: event.clientX, y: event.clientY, base: { hue: current.hue, sat: current.sat, lum: current.lum } }
        useUiStore.getState().setTatBand(band)
        useHistoryStore.getState().beginCoalesce(`hsl.${band}.tat`)
        event.currentTarget.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event: React.PointerEvent) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = (event.clientX - drag.x) * SENSITIVITY
        const dy = (event.clientY - drag.y) * SENSITIVITY
        const hue = event.altKey ? clampAdjust(drag.base.hue + dx) : drag.base.hue
        const sat = event.altKey ? drag.base.sat : clampAdjust(drag.base.sat + dx)
        const lum = event.altKey ? drag.base.lum : clampAdjust(drag.base.lum - dy)
        useEditStore.getState().edit(
            (draft) => {
                draft.color.hsl[drag.band] = { hue, sat, lum }
            },
            { coalesceKey: `hsl.${drag.band}.tat`, label: t('history.tatAdjust', { band: bandLabel(drag.band) }) },
        )
    }

    const onPointerUp = (event: React.PointerEvent) => {
        if (!dragRef.current) return
        dragRef.current = null
        useHistoryStore.getState().endCoalesce()
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }

    return (
        <div
            className='absolute inset-0 touch-none'
            style={{ cursor: 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
        />
    )
}
