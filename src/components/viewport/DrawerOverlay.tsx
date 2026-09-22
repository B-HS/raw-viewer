import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
    activeDrawerLayerId,
    appendDrawerObject,
    DEFAULT_DRAWER_TRANSFORM,
    ensureDrawerLayer,
    mutateLastDrawerObject,
    setDrawerLayerTransform,
} from '../../store/drawer'
import { useEditStore } from '../../store/editStore'
import { useHistoryStore } from '../../store/historyStore'
import { useUiStore } from '../../store/uiStore'
import { useViewportProjection } from '../../store/viewportProjection'
import { drawerPointToLocal } from '../../gl/drawer-coordinates'
import { usePlaylist } from '../../store/playlist'
import type { DrawerTransform } from '../../types/DrawerTransform'
import { canvasToUvUnclamped, uvToCanvas } from './projection'

const MIN_POINT_DISTANCE_UV = 0.002

const LASSO_CLOSE_THRESHOLD_PX = 12

const PERCENT = 100

type ActiveDrag =
    | { kind: 'draw'; layerId: string; last: [number, number] }
    | { kind: 'shape'; layerId: string }
    | { kind: 'move'; layerId: string; startU: number; startV: number; base: DrawerTransform }

type TextDraft = { x: number; y: number; u: number; v: number; value: string; layerId: string; size: number; color: string }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export const DrawerOverlay: FC = () => {
    const rootRef = useRef<HTMLDivElement>(null)
    const dragRef = useRef<ActiveDrag | null>(null)
    const [textDraft, setTextDraft] = useState<TextDraft | null>(null)
    const [lassoDraft, setLassoDraft] = useState<[number, number][]>([])
    const tool = useUiStore((state) => state.drawerTool)
    const color = useUiStore((state) => state.drawerColor)
    const size = useUiStore((state) => state.drawerSize)
    const opacity = useUiStore((state) => state.drawerOpacity)
    const panHeld = useUiStore((state) => state.drawerPanHeld)
    const fill = useUiStore((state) => state.drawerFill)
    const selection = useUiStore((state) => state.drawerSelection)
    const cloneSource = useUiStore((state) => state.drawerCloneSource)
    const model = useViewportProjection((state) => state.model)
    const clientW = useViewportProjection((state) => state.clientW)
    const clientH = useViewportProjection((state) => state.clientH)

    const { t } = useTranslation()

    useEffect(() => () => useHistoryStore.getState().endCoalesce(), [])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            if (lassoDraft.length > 0) setLassoDraft([])
            else if (useUiStore.getState().drawerSelection) useUiStore.getState().setDrawerSelection(null)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [lassoDraft.length])

    if (!model) return null

    const toUv = (event: { clientX: number; clientY: number }, clamp: boolean) => {
        const rect = rootRef.current?.getBoundingClientRect()
        if (!rect) return null
        const uv = canvasToUvUnclamped(model, clientW, clientH, event.clientX - rect.left, event.clientY - rect.top)
        if (!uv) return null
        if (!clamp && (uv.u < 0 || uv.u > 1 || uv.v < 0 || uv.v > 1)) return null
        return [clamp01(uv.u), clamp01(uv.v)] satisfies [number, number]
    }
    const toCanvasPoint = (point: readonly [number, number]) => uvToCanvas(model, clientW, clientH, point[0], point[1])

    const toLocal = (point: [number, number], layerId: string) => {
        const layer = useEditStore.getState().state?.drawer?.layers.find((item) => item.id === layerId)
        const playlist = usePlaylist.getState()
        const entry = playlist.entries[playlist.currentIndex]
        const level = entry ? playlist.best[entry.imageId] : undefined
        if (!level) return point
        return drawerPointToLocal(point, layer?.transform ?? null, level.width, level.height)
    }

    const commitText = () => {
        if (!textDraft) return
        const trimmed = textDraft.value.trim()
        setTextDraft(null)
        if (trimmed.length === 0) return
        appendDrawerObject(textDraft.layerId, {
            kind: 'text',
            text: trimmed,
            color: textDraft.color,
            size: textDraft.size,
            position: [textDraft.u, textDraft.v],
        })
    }

    const beginCapturedDrag = (drag: ActiveDrag, pointerId: number, coalesceKey: string) => {
        useHistoryStore.getState().beginCoalesce(coalesceKey)
        dragRef.current = drag
        rootRef.current?.setPointerCapture(pointerId)
    }

    const onPointerDown = (event: React.PointerEvent) => {
        if (event.button !== 0 || dragRef.current || panHeld || tool === 'hand') return
        const point = toUv(event, false)
        if (!point) return
        if (tool === 'text') {
            if (textDraft) commitText()
            const rect = rootRef.current?.getBoundingClientRect()
            if (!rect) return
            const layerId = ensureDrawerLayer()
            if (!layerId) return
            const local = toLocal(point, layerId)
            const scale = useEditStore.getState().state?.drawer?.layers.find((layer) => layer.id === layerId)?.transform?.scale ?? PERCENT
            setTextDraft({
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                u: local[0],
                v: local[1],
                value: '',
                layerId,
                size: (size * PERCENT) / scale,
                color,
            })
            return
        }
        if (tool === 'lasso') {
            if (lassoDraft.length >= 3) {
                const first = toCanvasPoint(lassoDraft[0])
                const current = toCanvasPoint(point)
                if (Math.hypot(first.x - current.x, first.y - current.y) <= LASSO_CLOSE_THRESHOLD_PX) {
                    useUiStore.getState().setDrawerSelection(lassoDraft)
                    setLassoDraft([])
                    return
                }
            }
            setLassoDraft([...lassoDraft, point])
            return
        }
        if (tool === 'fill') {
            const layerId = ensureDrawerLayer()
            if (layerId !== null)
                appendDrawerObject(layerId, {
                    kind: 'fill',
                    color,
                    seed: toLocal(point, layerId),
                    clip: selection?.map((item) => toLocal(item, layerId)) ?? null,
                })
            return
        }
        if (tool === 'move') {
            const layerId = activeDrawerLayerId()
            if (layerId === null) return
            const layer = useEditStore.getState().state?.drawer?.layers.find((item) => item.id === layerId)
            const base = layer?.transform ?? DEFAULT_DRAWER_TRANSFORM
            beginCapturedDrag({ kind: 'move', layerId, startU: point[0], startV: point[1], base }, event.pointerId, `drawer.transform.${layerId}`)
            return
        }
        if (tool === 'clone' && (event.altKey || !cloneSource)) {
            useUiStore.getState().setDrawerCloneSource(point)
            return
        }
        const layerId = ensureDrawerLayer()
        if (layerId === null) return
        const localPoint = toLocal(point, layerId)
        const clip = selection?.map((item) => toLocal(item, layerId)) ?? null
        const scale = useEditStore.getState().state?.drawer?.layers.find((layer) => layer.id === layerId)?.transform?.scale ?? PERCENT
        const localSize = (size * PERCENT) / scale
        if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') {
            beginCapturedDrag({ kind: 'draw', layerId, last: localPoint }, event.pointerId, 'drawer.draw')
            appendDrawerObject(layerId, { kind: 'stroke', tool, color, size: localSize, opacity, points: [localPoint], clip })
            return
        }
        if (tool === 'clone') {
            if (!cloneSource) return
            const localSource = toLocal(cloneSource, layerId)
            const offset: [number, number] = [localSource[0] - localPoint[0], localSource[1] - localPoint[1]]
            beginCapturedDrag({ kind: 'draw', layerId, last: localPoint }, event.pointerId, 'drawer.draw')
            appendDrawerObject(layerId, { kind: 'clone', points: [localPoint], offset, size: localSize, clip })
            return
        }
        if (tool === 'blur') {
            beginCapturedDrag({ kind: 'draw', layerId, last: localPoint }, event.pointerId, 'drawer.draw')
            appendDrawerObject(layerId, { kind: 'blur', points: [localPoint], size: localSize, clip })
            return
        }
        beginCapturedDrag({ kind: 'shape', layerId }, event.pointerId, 'drawer.draw')
        appendDrawerObject(layerId, { kind: 'shape', shape: tool, color, size: localSize, fill, from: localPoint, to: localPoint, clip })
    }

    const onPointerMove = (event: React.PointerEvent) => {
        const drag = dragRef.current
        if (!drag) return
        if (useHistoryStore.getState().dragKey === null) {
            dragRef.current = null
            return
        }
        const uv = toUv(event, true)
        if (!uv) return
        const point = drag.kind === 'move' ? uv : toLocal(uv, drag.layerId)
        if (drag.kind === 'draw') {
            if (Math.hypot(point[0] - drag.last[0], point[1] - drag.last[1]) < MIN_POINT_DISTANCE_UV) return
            drag.last = point
            mutateLastDrawerObject(drag.layerId, (object) => {
                if (object.kind === 'stroke' || object.kind === 'clone' || object.kind === 'blur') object.points.push(point)
            })
            return
        }
        if (drag.kind === 'shape') {
            mutateLastDrawerObject(drag.layerId, (object) => {
                if (object.kind === 'shape') object.to = point
            })
            return
        }
        setDrawerLayerTransform(drag.layerId, {
            offsetX: drag.base.offsetX + (point[0] - drag.startU) * PERCENT,
            offsetY: drag.base.offsetY + (point[1] - drag.startV) * PERCENT,
        })
    }

    const onPointerUp = (event: React.PointerEvent) => {
        if (!dragRef.current) return
        if (event.type === 'pointerup') onPointerMove(event)
        dragRef.current = null
        if (rootRef.current?.hasPointerCapture(event.pointerId)) rootRef.current.releasePointerCapture(event.pointerId)
        useHistoryStore.getState().endCoalesce()
    }

    const polygonPath = (points: readonly [number, number][], close: boolean) =>
        points
            .map((point, index) => {
                const canvasPoint = toCanvasPoint(point)
                return `${index === 0 ? 'M' : 'L'} ${canvasPoint.x} ${canvasPoint.y}`
            })
            .join(' ') + (close ? ' Z' : '')

    const cloneMarker = cloneSource ? toCanvasPoint(cloneSource) : null

    return (
        <div
            ref={rootRef}
            className='absolute inset-0 touch-none'
            style={{ cursor: tool === 'move' ? 'move' : 'crosshair', pointerEvents: panHeld || tool === 'hand' ? 'none' : 'auto' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onLostPointerCapture={onPointerUp}>
            <svg className='pointer-events-none absolute inset-0 h-full w-full'>
                {selection && selection.length >= 3 && (
                    <path
                        d={polygonPath(selection, true)}
                        fill='rgba(56, 189, 248, 0.06)'
                        stroke='rgba(56, 189, 248, 0.9)'
                        strokeWidth='1'
                        strokeDasharray='4 3'
                    />
                )}
                {lassoDraft.length > 0 && (
                    <path d={polygonPath(lassoDraft, false)} fill='none' stroke='rgba(250, 204, 21, 0.9)' strokeWidth='1' strokeDasharray='4 3' />
                )}
                {lassoDraft.length > 0 && (
                    <circle
                        cx={toCanvasPoint(lassoDraft[0]).x}
                        cy={toCanvasPoint(lassoDraft[0]).y}
                        r='5'
                        fill='none'
                        stroke='rgba(250, 204, 21, 0.9)'
                    />
                )}
                {cloneMarker && (
                    <g stroke='rgba(74, 222, 128, 0.9)' fill='none'>
                        <circle cx={cloneMarker.x} cy={cloneMarker.y} r='6' />
                        <path
                            d={`M ${cloneMarker.x - 9} ${cloneMarker.y} H ${cloneMarker.x + 9} M ${cloneMarker.x} ${cloneMarker.y - 9} V ${cloneMarker.y + 9}`}
                        />
                    </g>
                )}
            </svg>
            {textDraft && (
                <input
                    autoFocus
                    value={textDraft.value}
                    placeholder={t('panel.drawer.textPlaceholder')}
                    aria-label={t('panel.drawer.textPlaceholder')}
                    onChange={(event) => setTextDraft({ ...textDraft, value: event.target.value })}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') commitText()
                        if (event.key === 'Escape') setTextDraft(null)
                    }}
                    onBlur={commitText}
                    onPointerDown={(event) => event.stopPropagation()}
                    className='absolute w-44 rounded border border-sky-400 bg-black/80 px-2 py-1 text-xs outline-none'
                    style={{ left: textDraft.x, top: textDraft.y, color }}
                />
            )}
        </div>
    )
}
