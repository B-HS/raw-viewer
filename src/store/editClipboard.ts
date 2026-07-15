import { create } from 'zustand'
import { useEditStore } from './editStore'
import { usePlaylist } from './playlist'
import { PRESET_SECTIONS } from './presetStore'
import { useToast } from './toast'
import { copySettings } from '../ipc/preset'

const ALL_MASK = [...PRESET_SECTIONS]

const currentImageId = () => {
    const state = usePlaylist.getState()
    return state.entries[state.currentIndex]?.imageId ?? null
}

type EditClipboardState = {
    sourceImageId: string | null
    copy: () => void
    pasteTo: (targets: string[]) => Promise<void>
    pastePrevious: () => Promise<void>
    syncSelection: (targets: string[]) => Promise<void>
}

export const useEditClipboard = create<EditClipboardState>((set, get) => ({
    sourceImageId: null,
    copy: () => {
        const imageId = currentImageId()
        if (!imageId) return
        set({ sourceImageId: imageId })
        useToast.getState().show('편집 설정 복사됨')
    },
    pasteTo: async (targets) => {
        const source = get().sourceImageId
        if (!source || targets.length === 0) return
        const current = currentImageId()
        try {
            await useEditStore.getState().flushPending()
            await copySettings(source, targets, ALL_MASK)
            if (current && targets.includes(current)) await useEditStore.getState().applyServerState('편집 설정 붙여넣기')
            useToast.getState().show(targets.length > 1 ? `${targets.length}개에 붙여넣기` : '편집 설정 붙여넣기')
        } catch {
            useToast.getState().show('붙여넣기 실패')
        }
    },
    pastePrevious: async () => {
        const state = usePlaylist.getState()
        const current = state.entries[state.currentIndex]
        const previous = state.entries[state.currentIndex - 1]
        if (!current || !previous) return
        try {
            await useEditStore.getState().flushPending()
            await copySettings(previous.imageId, [current.imageId], ALL_MASK)
            await useEditStore.getState().applyServerState('이전 이미지 설정 붙여넣기')
            useToast.getState().show('이전 이미지 설정 적용')
        } catch {
            useToast.getState().show('붙여넣기 실패')
        }
    },
    syncSelection: async (targets) => {
        const current = currentImageId()
        if (!current || targets.length === 0) return
        try {
            await useEditStore.getState().flushPending()
            await copySettings(current, targets, ALL_MASK)
            useToast.getState().show(`${targets.length}개 동기화됨`)
        } catch {
            useToast.getState().show('동기화 실패')
        }
    },
}))
