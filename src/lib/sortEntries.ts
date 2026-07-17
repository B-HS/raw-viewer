import type { ImageEntry } from '../types/ImageEntry'

export type SortKey = 'name' | 'captureDate' | 'modifiedDate' | 'fileSize' | 'rating'

export type SortOrder = 'asc' | 'desc'

export type SortAux = { captureMs?: Record<string, number | null>; ratings?: Record<string, number> }

export const SORT_KEYS: readonly SortKey[] = ['name', 'captureDate', 'modifiedDate', 'fileSize', 'rating']

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export const sortEntries = (entries: ImageEntry[], key: SortKey, order: SortOrder, aux: SortAux = {}) => {
    const direction = order === 'asc' ? 1 : -1
    const value = (entry: ImageEntry) => {
        if (key === 'modifiedDate') return entry.modifiedMs
        if (key === 'fileSize') return entry.fileSize
        if (key === 'captureDate') return aux.captureMs?.[entry.imageId] ?? null
        if (key === 'rating') return aux.ratings?.[entry.imageId] ?? 0
        return null
    }
    return [...entries].sort((a, b) => {
        if (key !== 'name') {
            const left = value(a)
            const right = value(b)
            if (left != null && right != null && left !== right) return (left - right) * direction
            if (left != null && right == null) return -1
            if (left == null && right != null) return 1
        }
        return collator.compare(a.fileName, b.fileName) * (key === 'name' ? direction : 1)
    })
}
