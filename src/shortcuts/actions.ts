import { revealInFileManager } from '../ipc/platform'
import { smartCopyCurrent } from '../actions/smartCopy'
import { isFilterActive, useFilter } from '../store/filter'
import { useEditStore } from '../store/editStore'
import { useExportStore } from '../store/exportStore'
import { useGridView } from '../store/gridView'
import { useLayout } from '../store/layout'
import { useOrganize } from '../store/organize'
import { useOverlays } from '../store/overlays'
import { usePlaylist } from '../store/playlist'
import { usePresetStore } from '../store/presetStore'
import { useToast } from '../store/toast'
import { requestZoom } from '../store/viewportCommand'
import type { RecentEntry } from '../types/RecentEntry'
import type { TFunction } from 'i18next'

export type PaletteAction = { id: string; group: string; title: string; keywords?: string; run: () => void }

type NavDirection = 'prev' | 'next' | 'first' | 'last'

const filteredList = () => {
    const playlist = usePlaylist.getState()
    return playlist.filteredIndices.length > 0 || isFilterActive(useFilter.getState())
        ? playlist.filteredIndices
        : playlist.entries.map((_, index) => index)
}

const navigate = (direction: NavDirection) => {
    const list = filteredList()
    if (list.length === 0) return
    const playlist = usePlaylist.getState()
    const position = Math.max(0, list.indexOf(playlist.currentIndex))
    const next = direction === 'prev' ? position - 1 : direction === 'next' ? position + 1 : direction === 'first' ? 0 : list.length - 1
    playlist.focusIndex(list[Math.max(0, Math.min(list.length - 1, next))])
}

const targets = () => {
    const playlist = usePlaylist.getState()
    if (playlist.selection.length > 0) return playlist.selection
    const current = playlist.entries[playlist.currentIndex]
    return current ? [current.imageId] : []
}

const currentEntry = () => {
    const playlist = usePlaylist.getState()
    return playlist.entries[playlist.currentIndex]
}

export const buildActions = (t: TFunction, ctx: { openFile: () => void }): PaletteAction[] => {
    const nav = t('palette.group.navigation')
    const zoom = t('palette.group.zoom')
    const rating = t('palette.group.rating')
    const flag = t('palette.group.flag')
    const panel = t('palette.group.panel')
    const edit = t('palette.group.edit')
    const exportGroup = t('palette.group.export')
    const presetGroup = t('palette.group.preset')
    const file = t('palette.group.file')
    const settings = t('palette.group.settings')

    const actions: PaletteAction[] = [
        { id: 'nav.next', group: nav, title: t('palette.action.next'), run: () => navigate('next') },
        { id: 'nav.prev', group: nav, title: t('palette.action.prev'), run: () => navigate('prev') },
        { id: 'nav.first', group: nav, title: t('palette.action.first'), run: () => navigate('first') },
        { id: 'nav.last', group: nav, title: t('palette.action.last'), run: () => navigate('last') },
        { id: 'zoom.fit', group: zoom, title: t('palette.action.fit'), run: () => requestZoom('fit') },
        { id: 'zoom.actual', group: zoom, title: t('palette.action.zoom100'), run: () => requestZoom('actual') },
        { id: 'zoom.double', group: zoom, title: t('palette.action.zoom200'), run: () => requestZoom('double') },
        { id: 'rating.0', group: rating, title: t('palette.action.ratingClear'), run: () => useOrganize.getState().setRating(targets(), 0) },
    ]

    for (let value = 1; value <= 5; value++) {
        actions.push({
            id: `rating.${value}`,
            group: rating,
            title: t('palette.action.rating', { count: value }),
            run: () => useOrganize.getState().setRating(targets(), value),
        })
    }

    actions.push(
        { id: 'flag.pick', group: flag, title: t('palette.action.flagPick'), run: () => useOrganize.getState().setFlag(targets(), 'pick') },
        { id: 'flag.reject', group: flag, title: t('palette.action.flagReject'), run: () => useOrganize.getState().setFlag(targets(), 'reject') },
        { id: 'flag.clear', group: flag, title: t('palette.action.flagClear'), run: () => useOrganize.getState().setFlag(targets(), null) },
        { id: 'panel.edit', group: panel, title: t('palette.action.toggleEdit'), run: () => useLayout.getState().toggleEditPanel() },
        { id: 'panel.meta', group: panel, title: t('palette.action.toggleMeta'), run: () => useLayout.getState().toggleMetaPanel() },
        { id: 'panel.preset', group: panel, title: t('palette.action.togglePreset'), run: () => useLayout.getState().selectRightPanel('preset') },
        { id: 'panel.filmstrip', group: panel, title: t('palette.action.toggleFilmstrip'), run: () => useLayout.getState().toggleFilmstrip() },
        { id: 'panel.history', group: panel, title: t('palette.action.toggleHistory'), run: () => useLayout.getState().selectRightPanel('history') },
        { id: 'view.grid', group: panel, title: t('palette.action.toggleGrid'), run: () => useGridView.getState().toggle() },
        { id: 'edit.copyImage', group: edit, title: t('palette.action.copyImage'), run: () => smartCopyCurrent() },
        {
            id: 'edit.copyPath',
            group: edit,
            title: t('palette.action.copyPath'),
            run: () => {
                const entry = currentEntry()
                if (entry)
                    navigator.clipboard
                        .writeText(entry.path)
                        .then(() => useToast.getState().show(t('toast.pathCopied')))
                        .catch(() => undefined)
            },
        },
        {
            id: 'edit.reveal',
            group: edit,
            title: t('palette.action.reveal'),
            run: () => {
                const entry = currentEntry()
                if (entry) revealInFileManager(entry.imageId).catch(() => undefined)
            },
        },
        { id: 'edit.reset', group: edit, title: t('palette.action.resetEdit'), run: () => useEditStore.getState().resetAll() },
        { id: 'export.raster', group: exportGroup, title: t('palette.action.export'), run: () => useExportStore.getState().openDialog(targets()) },
        {
            id: 'export.dng',
            group: exportGroup,
            title: t('palette.action.exportDng'),
            run: () => {
                const entry = currentEntry()
                if (entry) useExportStore.getState().runDng(entry.imageId, entry.fileName, entry)
            },
        },
        { id: 'file.open', group: file, title: t('palette.action.openFile'), run: () => ctx.openFile() },
        { id: 'settings.open', group: settings, title: t('palette.action.openSettings'), run: () => useOverlays.getState().openSettings() },
        { id: 'settings.about', group: settings, title: t('palette.action.openAbout'), run: () => useOverlays.getState().openAbout() },
    )

    for (const preset of usePresetStore.getState().presets) {
        actions.push({
            id: `preset.${preset.id}`,
            group: presetGroup,
            title: t('palette.action.applyPreset', { name: preset.name }),
            keywords: preset.name,
            run: () => usePresetStore.getState().applyToCurrent(preset.id, preset.name),
        })
    }

    return actions
}

export const recentActions = (t: TFunction, recents: RecentEntry[], openPath: (path: string) => void): PaletteAction[] =>
    recents.map((recent) => ({
        id: `recent.${recent.path}`,
        group: t('palette.group.file'),
        title: t('palette.action.recent', { name: recent.filename }),
        keywords: recent.path,
        run: () => openPath(recent.path),
    }))
