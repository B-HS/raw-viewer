import { create } from 'zustand'

type ToastState = {
    message: string | null
    show: (message: string) => void
}

const TOAST_DURATION_MS = 1800

let timer: ReturnType<typeof setTimeout> | null = null

export const useToast = create<ToastState>((set) => ({
    message: null,
    show: (message) => {
        if (timer) clearTimeout(timer)
        set({ message })
        timer = setTimeout(() => set({ message: null }), TOAST_DURATION_MS)
    },
}))
