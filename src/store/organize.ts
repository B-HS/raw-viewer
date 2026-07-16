import { create } from 'zustand'
import { getOrganize, setFlag as setFlagCommand, setLabel as setLabelCommand, setRating as setRatingCommand } from '../ipc/organize'
import type { Flag } from '../types/Flag'
import type { OrganizeEntry } from '../types/OrganizeEntry'

export type LabelDef = { name: string; color: string }

export const LABELS: LabelDef[] = [
    { name: 'Red', color: '#e5484d' },
    { name: 'Yellow', color: '#f5d90a' },
    { name: 'Green', color: '#46a758' },
    { name: 'Blue', color: '#3b82f6' },
    { name: 'Purple', color: '#8b5cf6' },
]

export const labelColor = (label: string | null) => LABELS.find((entry) => entry.name === label)?.color ?? null

const emptyEntry = (imageId: string) => ({ imageId, rating: 0, flag: null, label: null })

type OrganizePatch = Partial<Pick<OrganizeEntry, 'rating' | 'flag' | 'label'>>

type OrganizeState = {
    entries: Record<string, OrganizeEntry>
    edited: Record<string, boolean>
    version: number
    loadMany: (imageIds: string[]) => Promise<void>
    setRating: (imageIds: string[], rating: number) => void
    setFlag: (imageIds: string[], flag: Flag | null) => void
    setLabel: (imageIds: string[], label: string | null) => void
    markEdited: (imageId: string, edited: boolean) => void
    forget: (imageIds: string[]) => void
    get: (imageId: string) => OrganizeEntry | undefined
}

export const useOrganize = create<OrganizeState>((set, get) => {
    const applyOptimistic = (imageIds: string[], patch: OrganizePatch, run: () => Promise<void>) => {
        if (imageIds.length === 0) return
        const previous = imageIds.map((id) => [id, get().entries[id]] as const)
        set((state) => {
            const entries = { ...state.entries }
            for (const id of imageIds) entries[id] = { ...(entries[id] ?? emptyEntry(id)), ...patch }
            return { entries, version: state.version + 1 }
        })
        run().catch(() =>
            set((state) => {
                const entries = { ...state.entries }
                for (const [id, value] of previous) {
                    if (value) entries[id] = value
                    else delete entries[id]
                }
                return { entries, version: state.version + 1 }
            }),
        )
    }

    return {
        entries: {},
        edited: {},
        version: 0,
        loadMany: async (imageIds) => {
            if (imageIds.length === 0) return
            const list = await getOrganize(imageIds).catch(() => [] as OrganizeEntry[])
            if (list.length === 0) return
            set((state) => {
                const entries = { ...state.entries }
                for (const entry of list) entries[entry.imageId] = entry
                return { entries, version: state.version + 1 }
            })
        },
        setRating: (imageIds, rating) => {
            const clamped = rating < 0 ? 0 : rating > 5 ? 5 : rating
            applyOptimistic(imageIds, { rating: clamped }, () => setRatingCommand(imageIds, clamped))
        },
        setFlag: (imageIds, flag) => applyOptimistic(imageIds, { flag }, () => setFlagCommand(imageIds, flag)),
        setLabel: (imageIds, label) => applyOptimistic(imageIds, { label }, () => setLabelCommand(imageIds, label)),
        markEdited: (imageId, edited) =>
            set((state) =>
                state.edited[imageId] === edited ? state : { edited: { ...state.edited, [imageId]: edited }, version: state.version + 1 },
            ),
        forget: (imageIds) =>
            set((state) => {
                const entries = { ...state.entries }
                const edited = { ...state.edited }
                for (const id of imageIds) {
                    delete entries[id]
                    delete edited[id]
                }
                return { entries, edited, version: state.version + 1 }
            }),
        get: (imageId) => get().entries[imageId],
    }
})
