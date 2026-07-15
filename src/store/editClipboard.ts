import { create } from 'zustand'
import { useEditStore } from './editStore'
import type { EditState } from '../types/EditState'

type EditClipboardState = {
    clip: EditState | null
    copy: (state: EditState) => void
    paste: () => void
}

export const useEditClipboard = create<EditClipboardState>((set, get) => ({
    clip: null,
    copy: (state) => set({ clip: structuredClone(state) }),
    paste: () => {
        const clip = get().clip
        if (!clip) return
        useEditStore.getState().edit(
            (draft) => {
                draft.wb = structuredClone(clip.wb)
                draft.lens = structuredClone(clip.lens)
                draft.geometry = structuredClone(clip.geometry)
                draft.crop = clip.crop ? structuredClone(clip.crop) : null
                draft.tone = structuredClone(clip.tone)
                draft.baseCurve = clip.baseCurve
                draft.curves = structuredClone(clip.curves)
                draft.color = structuredClone(clip.color)
                draft.detail = structuredClone(clip.detail)
                draft.effects = structuredClone(clip.effects)
            },
            { label: '편집 설정 붙여넣기' },
        )
    },
}))
