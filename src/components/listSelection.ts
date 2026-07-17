import { useContextMenu } from '../store/contextMenu'
import { usePlaylist } from '../store/playlist'
import type { MouseEvent } from 'react'

type PlaylistEntries = ReturnType<typeof usePlaylist.getState>['entries']

export const selectEntryAt = (list: number[], entries: PlaylistEntries, visiblePos: number, entryIndex: number, event: MouseEvent) => {
    if (event.metaKey) return usePlaylist.getState().selectToggle(entryIndex)
    if (event.shiftKey) {
        const anchor = usePlaylist.getState().selectionAnchor
        const anchorPos = anchor == null ? -1 : list.indexOf(anchor)
        if (anchorPos < 0) return usePlaylist.getState().focusIndex(entryIndex)
        const lo = Math.min(anchorPos, visiblePos)
        const hi = Math.max(anchorPos, visiblePos)
        const ids = list.slice(lo, hi + 1).map((index) => entries[index].imageId)
        return usePlaylist.getState().selectRange(ids, entryIndex)
    }
    usePlaylist.getState().focusIndex(entryIndex)
}

export const openEntryContext = (entries: PlaylistEntries, entryIndex: number, event: MouseEvent) => {
    event.preventDefault()
    const state = usePlaylist.getState()
    const id = entries[entryIndex].imageId
    const targets = state.selection.length > 1 && state.selection.includes(id) ? state.selection : [id]
    if (!state.selection.includes(id)) state.focusIndex(entryIndex)
    useContextMenu.getState().openAt(event.clientX, event.clientY, targets)
}
