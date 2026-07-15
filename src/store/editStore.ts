import { applyPatches as applyImmerPatches, enablePatches, produceWithPatches } from 'immer'
import { create } from 'zustand'
import { cloneDefaultSection, DEFAULT_EDIT_STATE, isDefault } from './editDefaults'
import { useHistoryStore } from './historyStore'
import { useUiStore } from './uiStore'
import { getEditState, isConflictError, resetEditState, setEditStateCommand } from '../ipc/commands'
import type { EditSection } from './editDefaults'
import type { Patch } from 'immer'
import type { EditState } from '../types/EditState'

enablePatches()

const SAVE_DEBOUNCE_MS = 500

const SECTION_LABEL: Record<EditSection, string> = {
    basic: '기본',
    'tone-curve': '톤 커브',
    hsl: 'HSL',
    detail: '디테일',
    effects: '효과',
    crop: '크롭 · 기하',
}

const EDIT_KEYS = Object.keys(DEFAULT_EDIT_STATE) as (keyof EditState)[]

const replaceRootPatches = (from: EditState, to: EditState): Patch[] =>
    EDIT_KEYS.filter((key) => from[key] !== to[key]).map((key) => ({ op: 'replace', path: [key], value: to[key] }))

type EditStoreState = {
    imageId: string | null
    isRaw: boolean
    state: EditState | null
    version: number
    dirtyFromDefault: boolean
    loadForImage: (imageId: string, isRaw: boolean) => Promise<void>
    edit: (recipe: (draft: EditState) => void, meta: { label: string; coalesceKey?: string }) => void
    applyPatches: (patches: Patch[]) => void
    resetAll: () => Promise<void>
    resetSection: (section: EditSection) => void
    applyServerState: (label: string) => Promise<void>
    flushPending: () => Promise<void>
}

export const useEditStore = create<EditStoreState>((set, get) => {
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    let queued = false
    let chain: Promise<void> = Promise.resolve()
    let loadToken = 0

    const pushEngine = (next: EditState | null) => useUiStore.getState().engine?.setEditState(next)

    const doSave = async () => {
        if (saveTimer) {
            clearTimeout(saveTimer)
            saveTimer = null
        }
        if (!queued) return
        const { imageId, state, version } = get()
        if (!imageId || !state) {
            queued = false
            return
        }
        queued = false
        try {
            const newVersion = await setEditStateCommand(imageId, state, version)
            if (get().imageId === imageId) set({ version: newVersion })
        } catch (error) {
            if (isConflictError(error) && get().imageId === imageId) {
                try {
                    const envelope = await getEditState(imageId)
                    if (get().imageId === imageId) {
                        set({ state: envelope.state, version: envelope.editVersion, dirtyFromDefault: !envelope.isDefault })
                        pushEngine(envelope.state)
                    }
                } catch {}
            }
        }
    }

    const enqueueSave = () => {
        chain = chain.then(doSave)
        return chain
    }

    const scheduleSave = () => {
        queued = true
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
            saveTimer = null
            enqueueSave()
        }, SAVE_DEBOUNCE_MS)
    }

    const commitReplacement = (imageId: string, prev: EditState, next: EditState, label: string, opts: { persist: boolean; version?: number }) => {
        const patches = replaceRootPatches(prev, next)
        if (patches.length === 0) {
            if (opts.version !== undefined) set({ version: opts.version })
            return
        }
        const inversePatches = replaceRootPatches(next, prev)
        if (opts.version !== undefined) set({ state: next, version: opts.version, dirtyFromDefault: !isDefault(next) })
        else set({ state: next, dirtyFromDefault: !isDefault(next) })
        pushEngine(next)
        useHistoryStore.getState().record(imageId, { patches, inversePatches, timestamp: Date.now(), label })
        if (opts.persist) scheduleSave()
    }

    return {
        imageId: null,
        isRaw: false,
        state: null,
        version: 0,
        dirtyFromDefault: false,
        loadForImage: async (imageId, isRaw) => {
            const token = ++loadToken
            try {
                const envelope = await getEditState(imageId)
                if (token !== loadToken) return
                set({ imageId, isRaw, state: envelope.state, version: envelope.editVersion, dirtyFromDefault: !envelope.isDefault })
                pushEngine(envelope.state)
            } catch {
                if (token !== loadToken) return
                set({ imageId, isRaw, state: DEFAULT_EDIT_STATE, version: 0, dirtyFromDefault: false })
                pushEngine(DEFAULT_EDIT_STATE)
            }
        },
        edit: (recipe, meta) => {
            const { state, imageId } = get()
            if (!state || !imageId) return
            const [afterRecipe, patches, inversePatches] = produceWithPatches(state, recipe)
            if (patches.length === 0) return
            const next: EditState = { ...afterRecipe, meta: { ...afterRecipe.meta, modifiedAt: Date.now() } }
            set({ state: next, dirtyFromDefault: !isDefault(next) })
            pushEngine(next)
            useHistoryStore
                .getState()
                .record(imageId, { patches, inversePatches, timestamp: Date.now(), label: meta.label, coalesceKey: meta.coalesceKey })
            scheduleSave()
        },
        applyPatches: (patches) => {
            const { state } = get()
            if (!state) return
            const next = applyImmerPatches(state, patches)
            set({ state: next, dirtyFromDefault: !isDefault(next) })
            pushEngine(next)
            scheduleSave()
        },
        resetAll: async () => {
            const { imageId, state } = get()
            if (!imageId || !state) return
            queued = false
            if (saveTimer) {
                clearTimeout(saveTimer)
                saveTimer = null
            }
            try {
                const envelope = await resetEditState(imageId)
                if (get().imageId !== imageId) return
                commitReplacement(imageId, get().state ?? state, envelope.state, '전체 초기화', { persist: false, version: envelope.editVersion })
            } catch {}
        },
        resetSection: (section) => {
            const { imageId, state } = get()
            if (!imageId || !state) return
            const next = cloneDefaultSection(section, state)
            commitReplacement(imageId, state, next, `${SECTION_LABEL[section]} 초기화`, { persist: true })
        },
        applyServerState: async (label) => {
            const { imageId, state } = get()
            if (!imageId || !state) return
            await get().flushPending()
            try {
                const envelope = await getEditState(imageId)
                if (get().imageId !== imageId) return
                commitReplacement(imageId, get().state ?? state, envelope.state, label, { persist: false, version: envelope.editVersion })
            } catch {}
        },
        flushPending: async () => {
            if (saveTimer) {
                clearTimeout(saveTimer)
                saveTimer = null
            }
            if (queued) {
                await enqueueSave()
                return
            }
            await chain
        },
    }
})
