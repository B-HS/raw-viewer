import { useRef } from 'react'
import type { FC, PointerEvent } from 'react'
import { useSettings } from '../../store/settings'

export const FilmstripResizer: FC = () => {
    const startRef = useRef<{ y: number; height: number } | null>(null)

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        startRef.current = { y: event.clientY, height: useSettings.getState().filmstripHeight }
    }

    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const start = startRef.current
        if (!start) return
        useSettings.getState().setFilmstripHeight(start.height - (event.clientY - start.y))
    }

    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        if (!startRef.current) return
        startRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        useSettings.getState().commitFilmstripHeight()
    }

    return (
        <div
            role='separator'
            aria-orientation='horizontal'
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className='h-1.5 shrink-0 cursor-ns-resize border-t border-neutral-800 bg-neutral-900 hover:bg-neutral-700'
        />
    )
}
