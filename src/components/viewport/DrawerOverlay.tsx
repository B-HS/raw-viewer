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
import type { DrawerTransform } from '../../types/DrawerTransform'
import { canvasToUvUnclamped, uvToCanvas } from './projection'

const MIN_POINT_DISTANCE_UV = 0.002

const LASSO_CLOSE_THRESHOLD_PX = 12

const PERCENT = 100

type ActiveDrag =
    | { kind: 'draw'; layerId: string; last: [number, number] }
    | { kind: 'shape'; layerId: string }
    | { kind: 'move'; layerId: string; startU: number; startV: number; base: DrawerTransform }

type TextDraft = { x: number; y: number; u: number; v: number; value: string }

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

export const DrawerOverlay: FC = () => {
    const rootRef = useRef<HTMLDivElement>(null)
    const dragRef = useRef<ActiveDrag | null>(null)
    const [textDraft, setTextDraft] = useState<TextDraft | null>(null)
    const [lassoDraft, setLassoDraft] = useState<[number, number][]>([])
    const tool = useUiStore((state) => state.drawerTool)
    const color = useUiStore((state) => state.drawerColor)
    const size = useUiStore((state) => state.drawerSize)
    const fill = useUiStore((state) => state.drawerFill)
    const selection = useUiStore((state) => state.drawerSelection)
    const cloneSource = useUiStore((state) => state.drawerCloneSource)
    const model = useViewportProjection((state) => state.model)
    const clientW = useViewportProjection((state) => state.clientW)
    const clientH = useViewportProjection((state) => state.clientH)

    const { t } = useTranslation()

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

    const toUv = (event: { clientX: number; clientY: number }) => {
        const rect = rootRef.current?.getBoundingClientRect()
        if (!rect) return null
        const uv = canvasToUvUnclamped(model, clientW, clientH, event.clientX - rect.left, event.clientY - rect.top)
        return uv ? ([clamp01(uv.u), clamp01(uv.v)] as [number, number]) : null
    }
    const toCanvasPoint = (point: readonly [number, number]) => uvToCanvas(model, clientW, clientH, point[0], point[1])

    const commitText = () => {
        if (!textDraft) return
        const trimmed = textDraft.value.trim()
        setTextDraft(null)
        if (trimmed.length === 0) return
        const layerId = ensureDrawerLayer()
        if (layerId === null) return
        appendDrawerObject(layerId, { kind: 'text', text: trimmed, color, size, position: [textDraft.u, textDraft.v] })
    }

    const beginCapturedDrag = (drag: ActiveDrag, pointerId: number, coalesceKey: string) => {
        useHistoryStore.getState().beginCoalesce(coalesceKey)
        dragRef.current = drag
        rootRef.current?.setPointerCapture(pointerId)
    }

    const onPointerDown = (event: React.PointerEvent) => {
        if (event.button !== 0) return
        const point = toUv(event)
        if (!point) return
        if (tool === 'text') {
            if (textDraft) commitText()
            const rect = rootRef.current?.getBoundingClientRect()
            if (!rect) return
            setTextDraft({ x: event.clientX - rect.left, y: event.clientY - rect.top, u: point[0], v: point[1], value: '' })
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
            if (layerId !== null) appendDrawerObject(layerId, { kind: 'fill', color, seed: point, clip: selection })
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
        if (tool === 'brush' || tool === 'pencil' || tool === 'eraser') {
            appendDrawerObject(layerId, { kind: 'stroke', tool, color, size, opacity: 100, points: [point], clip: selection })
            beginCapturedDrag({ kind: 'draw', layerId, last: point }, event.pointerId, 'drawer.draw')
            return
        }
        if (tool === 'clone') {
            if (!cloneSource) return
            const offset: [number, number] = [cloneSource[0] - point[0], cloneSource[1] - point[1]]
            appendDrawerObject(layerId, { kind: 'clone', points: [point], offset, size, clip: selection })
            beginCapturedDrag({ kind: 'draw', layerId, last: point }, event.pointerId, 'drawer.draw')
            return
        }
        if (tool === 'blur') {
            appendDrawerObject(layerId, { kind: 'blur', points: [point], size, clip: selection })
            beginCapturedDrag({ kind: 'draw', layerId, last: point }, event.pointerId, 'drawer.draw')
            return
        }
        appendDrawerObject(layerId, { kind: 'shape', shape: tool, color, size, fill, from: point, to: point, clip: selection })
        beginCapturedDrag({ kind: 'shape', layerId }, event.pointerId, 'drawer.draw')
    }

    const onPointerMove = (event: React.PointerEvent) => {
        const drag = dragRef.current
        if (!drag) return
        const point = toUv(event)
        if (!point) return
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
            style={{ cursor: tool === 'move' ? 'move' : 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}>
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
