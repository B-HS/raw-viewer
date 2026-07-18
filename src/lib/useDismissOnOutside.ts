import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Dismisses a popover when a pointer press lands outside the container
 * or when Escape is pressed, listening at the document level while active.
 */
export const useDismissOnOutside = (ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void) => {
    useEffect(() => {
        if (!active) return
        const onPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && ref.current?.contains(event.target)) return
            onDismiss()
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            onDismiss()
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown, true)
        }
    }, [ref, active, onDismiss])
}
