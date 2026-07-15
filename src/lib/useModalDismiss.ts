import { useEffect } from 'react'
import type { RefObject } from 'react'

const SELECTOR =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export const useModalDismiss = (ref: RefObject<HTMLElement | null>, onClose: () => void) => {
    useEffect(() => {
        const container = ref.current
        const previous = document.activeElement as HTMLElement | null
        const focusables = () =>
            Array.from(container?.querySelectorAll<HTMLElement>(SELECTOR) ?? []).filter((element) => element.offsetParent !== null)
        const initial = focusables()[0] ?? container
        initial?.focus()
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                onClose()
                return
            }
            if (event.key !== 'Tab') return
            const items = focusables()
            if (items.length === 0) {
                event.preventDefault()
                return
            }
            const first = items[0]
            const last = items[items.length - 1]
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
        }
        container?.addEventListener('keydown', onKey)
        return () => {
            container?.removeEventListener('keydown', onKey)
            previous?.focus?.()
        }
    }, [])
}
