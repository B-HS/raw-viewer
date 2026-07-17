import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useEffect, useRef, useState } from 'react'
import type { FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AboutDialog } from './components/AboutDialog'
import { CommandPalette } from './components/CommandPalette'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { ContextMenu } from './components/ContextMenu'
import { ExportDialog } from './components/ExportDialog'
import { Filmstrip } from './components/filmstrip/Filmstrip'
import { FilmstripResizer } from './components/filmstrip/FilmstripResizer'
import { FilterBar } from './components/filmstrip/FilterBar'
import { GridView } from './components/gridview/GridView'
import { HistoryPanel } from './components/HistoryPanel'
import { PerfOverlay } from './components/PerfOverlay'
import { EditPanel } from './components/panels/EditPanel'
import { MetaPanel } from './components/panels/MetaPanel/MetaPanel'
import { PresetPanel } from './components/panels/PresetPanel'
import { StatusBar } from './components/StatusBar'
import { Viewport } from './components/viewport/Viewport'
import { useSettingsTab } from './components/settings/settingsTab'
import { frontendReady, fullscreenState, navigate, openInNewWindow, openPath, scanDirectory, toggleFullscreen } from './ipc/commands'
import { onDecodeCrashLoop, onDockOpen, onFsChanged, onOpenRequest } from './ipc/events'
import { requestL2 } from './ipc/performance'
import { watchDirectory } from './ipc/fs'
import { flushOrganize } from './ipc/organize'
import { copyFilesToClipboard, noteRecent } from './ipc/platform'
import { smartCopyCurrent } from './actions/smartCopy'
import { confirmAndTrash } from './actions/trash'
import { zoomRatio } from './gl/viewTransform'
import { digitValue, isEditableTarget, KEYMAP, PAGE_STEP } from './shortcuts/keymap'
import { matchAction, resolveBinding } from './shortcuts/resolve'
import { applyCropAspect, CROP_ASPECTS, swapCropAspect, toggleCropMode } from './store/crop'
import { useContextMenu } from './store/contextMenu'
import { useEditClipboard } from './store/editClipboard'
import { useEditStore } from './store/editStore'
import { useExportStore } from './store/exportStore'
import { isFilterActive, matchesFilter, useFilter } from './store/filter'
import { useGridView } from './store/gridView'
import { useHistoryStore } from './store/historyStore'
import { useLayout } from './store/layout'
import { useLens } from './store/lens'
import { usePresetStore } from './store/presetStore'
import { useSettings } from './store/settings'
import type { RightPanel } from './store/layout'
import { useMeta } from './store/meta'
import { isOverlayBlocking, useOverlays } from './store/overlays'
import { LABELS, useOrganize } from './store/organize'
import { usePairs } from './store/pairs'
import { neighbors, usePlaylist } from './store/playlist'
import { useToast } from './store/toast'
import { useUiStore } from './store/uiStore'
import { useViewportProjection } from './store/viewportProjection'
import type { ImageEntry } from './types/ImageEntry'

const IMAGE_EXTENSIONS = [
    'cr2',
    'cr3',
    'arw',
    'nef',
    'nrw',
    'raf',
    'dng',
    'orf',
    'rw2',
    'pef',
    'x3f',
    'jpg',
    'jpeg',
    'png',
    'webp',
    'tif',
    'tiff',
    'heic',
    'heif',
    'avif',
    'bmp',
    'gif',
]

type NavDirection = 'prev' | 'next' | 'first' | 'last' | 'pageBack' | 'pageForward'

const activeFilteredList = () => {
    const state = usePlaylist.getState()
    if (state.filteredIndices.length > 0 || isFilterActive(useFilter.getState())) return state.filteredIndices
    return state.entries.map((_, index) => index)
}

const nextFilteredEntryIndex = (base: number, direction: NavDirection) => {
    const list = activeFilteredList()
    if (list.length === 0) return null
    let position = list.indexOf(base)
    if (position < 0) {
        position = list.findIndex((index) => index >= base)
        if (position < 0) position = list.length - 1
    }
    let next = position
    if (direction === 'prev') next = position - 1
    else if (direction === 'next') next = position + 1
    else if (direction === 'first') next = 0
    else if (direction === 'last') next = list.length - 1
    else if (direction === 'pageBack') next = position - PAGE_STEP
    else if (direction === 'pageForward') next = position + PAGE_STEP
    return list[Math.max(0, Math.min(list.length - 1, next))]
}

const organizeTargets = () => {
    const state = usePlaylist.getState()
    if (state.selection.length > 0) return state.selection
    const current = state.entries[state.currentIndex]
    return current ? [current.imageId] : []
}

const advanceToNextFiltered = () => {
    const target = nextFilteredEntryIndex(usePlaylist.getState().currentIndex, 'next')
    if (target != null) usePlaylist.getState().focusIndex(target)
}

const navigateFlagged = (direction: 'prev' | 'next') => {
    const state = usePlaylist.getState()
    const organize = useOrganize.getState().entries
    const flagged = activeFilteredList().filter((index) => organize[state.entries[index].imageId]?.flag === 'pick')
    if (flagged.length === 0) return
    const current = state.currentIndex
    const target = direction === 'next' ? flagged.find((index) => index > current) : [...flagged].reverse().find((index) => index < current)
    if (target != null) state.focusIndex(target)
}

const selectAllFiltered = () => {
    const state = usePlaylist.getState()
    usePlaylist.getState().selectAll(activeFilteredList().map((index) => state.entries[index].imageId))
}

const PANEL_TABS: readonly Exclude<RightPanel, 'none'>[] = ['edit', 'meta', 'preset', 'history']

const META_LOAD_DEBOUNCE_MS = 150
const L2_ZOOM_ENTER_RATIO = 0.999
const L2_ZOOM_EXIT_RATIO = 0.95

export const App: FC = () => {
    const pendingIndexRef = useRef<number | null>(null)
    const rafRef = useRef<number | null>(null)
    const closingRef = useRef(false)
    const handleOpenRef = useRef<(path: string) => void>(() => {})
    const l2ZoomRef = useRef<string | null>(null)
    const [pathInput, setPathInput] = useState('')
    const [openError, setOpenError] = useState('')
    const [crashLoopVisible, setCrashLoopVisible] = useState(false)

    const entryCount = usePlaylist((state) => state.entries.length)
    const currentImageId = usePlaylist((state) => state.entries[state.currentIndex]?.imageId ?? null)
    const scanning = usePlaylist((state) => state.scanning)
    const total = usePlaylist((state) => state.total)
    const selectionCount = usePlaylist((state) => state.selection.length)
    const rightPanel = useLayout((state) => state.rightPanel)
    const filmstripVisible = useLayout((state) => state.filmstripVisible)
    const filmstripHeight = useSettings((state) => state.filmstripHeight)
    const toastMessage = useToast((state) => state.message)
    const currentName = usePlaylist((state) => state.entries[state.currentIndex]?.fileName ?? '')
    const currentPosition = usePlaylist((state) => state.currentIndex)
    const gridActive = useGridView((state) => state.active)
    const isFullscreen = useUiStore((state) => state.isFullscreen)
    const { t } = useTranslation()

    const handleOpen = async (path: string) => {
        setOpenError('')
        try {
            const result = await openPath(path)
            usePlaylist.getState().openWith(result.entry, result.dir)
            useOrganize.getState().loadMany([result.entry.imageId])
            noteRecent(path).catch(() => undefined)
            watchDirectory(result.dir).catch(() => undefined)
            const summary = await scanDirectory(result.dir, (batch) => {
                usePlaylist.getState().addEntries(batch.entries, batch.done)
                useOrganize.getState().loadMany(batch.entries.map((entry) => entry.imageId))
            })
            usePlaylist.getState().setScanTotal(summary.total)
            usePairs.getState().load(result.dir)
        } catch (error) {
            setOpenError(error instanceof Error ? error.message : t('app.openFailed'))
        }
    }
    handleOpenRef.current = handleOpen

    const pickAndOpen = async () => {
        const selected = await openDialog({
            multiple: false,
            directory: false,
            title: t('app.openTitle'),
            filters: [{ name: t('app.imageFilter'), extensions: IMAGE_EXTENSIONS }],
        }).catch(() => null)
        if (typeof selected === 'string') handleOpenRef.current(selected)
    }

    const openContextMenu = (event: MouseEvent) => {
        event.preventDefault()
        const state = usePlaylist.getState()
        const current = state.entries[state.currentIndex]
        if (!current) return
        const targets = state.selection.length > 1 ? state.selection : [current.imageId]
        useContextMenu.getState().openAt(event.clientX, event.clientY, targets)
    }

    const openIsolationSettings = () => {
        useSettingsTab.getState().setTab('performance')
        useOverlays.getState().openSettings()
        setCrashLoopVisible(false)
    }

    useEffect(() => {
        let disposed = false
        let unlistenDrop: (() => void) | null = null
        frontendReady()
            .then((pending) => {
                if (!disposed && pending[0]) handleOpenRef.current(pending[0].path)
            })
            .catch(() => undefined)
        getCurrentWebview()
            .onDragDropEvent((event) => {
                if (event.payload.type === 'drop' && event.payload.paths[0]) handleOpenRef.current(event.payload.paths[0])
            })
            .then((unlisten) => {
                if (disposed) unlisten()
                else unlistenDrop = unlisten
            })
            .catch(() => undefined)
        return () => {
            disposed = true
            unlistenDrop?.()
        }
    }, [])

    useEffect(() => {
        let unlisten: (() => void) | null = null
        getCurrentWindow()
            .onCloseRequested(async (event) => {
                if (closingRef.current) return
                event.preventDefault()
                closingRef.current = true
                try {
                    await useEditStore.getState().flushPending()
                    await flushOrganize()
                } catch {}
                await getCurrentWindow().close()
            })
            .then((dispose) => {
                unlisten = dispose
            })
            .catch(() => undefined)
        return () => unlisten?.()
    }, [])

    useEffect(() => {
        let disposed = false
        let unlisten: (() => void) | null = null
        const reconcile = async (dir: string) => {
            const collected: ImageEntry[] = []
            await scanDirectory(dir, (batch) => collected.push(...batch.entries)).catch(() => undefined)
            usePlaylist.getState().syncEntries(collected)
            useOrganize.getState().loadMany(collected.map((entry) => entry.imageId))
        }
        onFsChanged((payload) => {
            const state = usePlaylist.getState()
            if (!state.dir) return
            if (payload.kind === 'modified') {
                const affected = new Set(payload.paths)
                const touched = state.entries.filter((entry) => affected.has(entry.path))
                if (touched.length === 0) return
                usePlaylist.getState().invalidate(touched.map((entry) => entry.imageId))
                const current = state.entries[state.currentIndex]
                if (current) {
                    const range = neighbors(state.entries, state.currentIndex, useSettings.getState().preloadRadius)
                    navigate(current.imageId, range.prevIds, range.nextIds).catch(() => undefined)
                    if (touched.some((entry) => entry.imageId === current.imageId)) {
                        useMeta.getState().clear()
                        useMeta.getState().loadForImage(current.imageId)
                    }
                }
                return
            }
            reconcile(state.dir)
        })
            .then((dispose) => {
                if (disposed) dispose()
                else unlisten = dispose
            })
            .catch(() => undefined)
        return () => {
            disposed = true
            unlisten?.()
        }
    }, [])

    useEffect(() => {
        const unsubscribe = useEditStore.subscribe((state) => {
            if (state.imageId) useOrganize.getState().markEdited(state.imageId, state.dirtyFromDefault)
        })
        return unsubscribe
    }, [])

    useEffect(() => {
        const recompute = () => {
            const { entries } = usePlaylist.getState()
            const filter = useFilter.getState()
            const organize = useOrganize.getState()
            const indices: number[] = []
            for (let index = 0; index < entries.length; index += 1) {
                const entry = entries[index]
                if (matchesFilter(filter, entry, organize.entries[entry.imageId], organize.edited[entry.imageId] ?? false)) indices.push(index)
            }
            usePlaylist.getState().setFilteredIndices(indices)
        }
        recompute()
        const unsubPlaylist = usePlaylist.subscribe((state, previous) => {
            if (state.entries !== previous.entries) recompute()
        })
        const unsubFilter = useFilter.subscribe(recompute)
        const unsubOrganize = useOrganize.subscribe((state, previous) => {
            if (state.version !== previous.version) recompute()
        })
        return () => {
            unsubPlaylist()
            unsubFilter()
            unsubOrganize()
        }
    }, [])

    useEffect(() => {
        const commit = () => {
            rafRef.current = null
            if (pendingIndexRef.current == null) return
            usePlaylist.getState().focusIndex(pendingIndexRef.current)
            pendingIndexRef.current = null
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (isEditableTarget(document.activeElement) || event.metaKey) return
            if (isOverlayBlocking() || useGridView.getState().active) return
            if (usePlaylist.getState().entries.length === 0) return
            const base = pendingIndexRef.current ?? usePlaylist.getState().currentIndex
            let direction: NavDirection | null = null
            if (matchAction(event, 'nav.previous')) direction = 'prev'
            else if (matchAction(event, 'nav.next')) direction = 'next'
            else if (matchAction(event, 'nav.first')) direction = 'first'
            else if (matchAction(event, 'nav.last')) direction = 'last'
            else if (matchAction(event, 'nav.pageBack')) direction = 'pageBack'
            else if (matchAction(event, 'nav.pageForward')) direction = 'pageForward'
            if (!direction) return
            event.preventDefault()
            const target = nextFilteredEntryIndex(base, direction)
            if (target == null) return
            pendingIndexRef.current = target
            if (rafRef.current == null) rafRef.current = requestAnimationFrame(commit)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
    }, [])

    useEffect(() => {
        const rotate = (delta: number) =>
            useEditStore
                .getState()
                .edit((draft) => void (draft.geometry.rotate90 = (((draft.geometry.rotate90 + delta) % 4) + 4) % 4), { label: t('history.rotate') })
        const cycleAspect = () => {
            const aspect = useEditStore.getState().state?.crop?.aspect ?? 'original'
            applyCropAspect(CROP_ASPECTS[(CROP_ASPECTS.indexOf(aspect) + 1) % CROP_ASPECTS.length])
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (isEditableTarget(document.activeElement)) return
            if (isOverlayBlocking()) return
            const ui = useUiStore.getState()
            if (matchAction(event, 'view.history')) {
                event.preventDefault()
                useLayout.getState().selectRightPanel('history')
            } else if (matchAction(event, 'nav.previousFlagged')) {
                event.preventDefault()
                navigateFlagged('prev')
            } else if (matchAction(event, 'nav.nextFlagged')) {
                event.preventDefault()
                navigateFlagged('next')
            } else if (matchAction(event, 'edit.undo')) {
                event.preventDefault()
                useHistoryStore.getState().undo()
            } else if (matchAction(event, 'edit.redo')) {
                event.preventDefault()
                useHistoryStore.getState().redo()
            } else if (matchAction(event, 'file.reveal')) {
                event.preventDefault()
                const current = usePlaylist.getState().entries[usePlaylist.getState().currentIndex]
                if (current) revealItemInDir(current.path).catch(() => undefined)
            } else if (matchAction(event, 'edit.reset')) {
                event.preventDefault()
                if (event.altKey) useEditStore.getState().resetSection(ui.activeSection)
                else useEditStore.getState().resetAll()
            } else if (matchAction(event, 'edit.rotateLeft')) {
                event.preventDefault()
                rotate(-1)
            } else if (matchAction(event, 'edit.rotateRight')) {
                event.preventDefault()
                rotate(1)
            } else if (event.metaKey && digitValue(event.code) >= 0) {
                event.preventDefault()
                event.stopImmediatePropagation()
                const value = digitValue(event.code)
                useOrganize.getState().setLabel(organizeTargets(), value === 0 ? null : LABELS[value - 1].name)
                if (event.shiftKey) advanceToNextFiltered()
            } else if (matchAction(event, 'file.open')) {
                event.preventDefault()
                pickAndOpen()
            } else if (matchAction(event, 'view.fullscreen')) {
                event.preventDefault()
                toggleFullscreen()
                    .then((on) => useUiStore.getState().setFullscreen(on))
                    .catch(() => undefined)
            } else if (matchAction(event, 'view.settings')) {
                event.preventDefault()
                useOverlays.getState().openSettings()
            } else if (matchAction(event, 'view.palette')) {
                event.preventDefault()
                useOverlays.getState().togglePalette()
            } else if (matchAction(event, 'clip.copyImage')) {
                event.preventDefault()
                smartCopyCurrent()
            } else if (matchAction(event, 'clip.copyFiles')) {
                event.preventDefault()
                copyFilesToClipboard(organizeTargets()).catch(() => undefined)
            } else if (matchAction(event, 'clip.copyPath')) {
                event.preventDefault()
                const current = usePlaylist.getState().entries[usePlaylist.getState().currentIndex]
                if (current)
                    navigator.clipboard
                        .writeText(current.path)
                        .then(() => useToast.getState().show(t('toast.pathCopied')))
                        .catch(() => undefined)
            } else if (matchAction(event, 'clip.copyEdit')) {
                event.preventDefault()
                useEditClipboard.getState().copy()
            } else if (matchAction(event, 'clip.pasteEdit')) {
                event.preventDefault()
                useEditClipboard.getState().pasteTo(organizeTargets())
            } else if (matchAction(event, 'clip.pastePrevious')) {
                event.preventDefault()
                useEditClipboard.getState().pastePrevious()
            } else if (matchAction(event, 'export.raster')) {
                event.preventDefault()
                const playlist = usePlaylist.getState()
                const current = playlist.entries[playlist.currentIndex]
                if (current) {
                    const targets = event.shiftKey && playlist.selection.length > 0 ? playlist.selection : [current.imageId]
                    useExportStore.getState().openDialog(targets)
                }
            } else if (matchAction(event, 'export.dng')) {
                event.preventDefault()
                const playlist = usePlaylist.getState()
                const current = playlist.entries[playlist.currentIndex]
                if (current) useExportStore.getState().runDng(current.imageId, current.fileName, current)
            } else if (matchAction(event, 'file.selectAll')) {
                event.preventDefault()
                selectAllFiltered()
            } else if (!event.metaKey && event.altKey && !event.shiftKey && /^Digit[1-9]$/.test(event.code)) {
                event.preventDefault()
                const preset = usePresetStore.getState().presets[Number(event.code.slice(5)) - 1]
                if (preset) usePresetStore.getState().applyToCurrent(preset.id, preset.name)
            } else if (!event.metaKey && digitValue(event.code) >= 0) {
                event.preventDefault()
                useOrganize.getState().setRating(organizeTargets(), digitValue(event.code))
                if (event.shiftKey) advanceToNextFiltered()
            } else if (matchAction(event, 'view.grid')) {
                event.preventDefault()
                useGridView.getState().toggle()
            } else if (matchAction(event, 'organize.flagPick')) {
                event.preventDefault()
                useOrganize.getState().setFlag(organizeTargets(), 'pick')
                if (event.shiftKey) advanceToNextFiltered()
            } else if (matchAction(event, 'organize.flagClear')) {
                event.preventDefault()
                useOrganize.getState().setFlag(organizeTargets(), null)
                if (event.shiftKey) advanceToNextFiltered()
            } else if (matchAction(event, 'view.metaPanel')) {
                event.preventDefault()
                useLayout.getState().toggleMetaPanel()
            } else if (matchAction(event, 'view.editPanel')) {
                event.preventDefault()
                useLayout.getState().toggleEditPanel()
            } else if (matchAction(event, 'view.filmstrip')) {
                event.preventDefault()
                useLayout.getState().toggleFilmstrip()
            } else if (matchAction(event, 'file.trash') || event.code === 'Delete') {
                event.preventDefault()
                confirmAndTrash(organizeTargets())
            } else if (matchAction(event, 'inspect.clip')) {
                event.preventDefault()
                ui.toggleClipping(event.shiftKey ? 'highlight' : event.altKey ? 'shadow' : 'both')
            } else if (matchAction(event, 'compare.split')) {
                event.preventDefault()
                if (event.shiftKey || event.altKey) ui.toggleCompare(event.altKey ? 'y' : 'x')
                else ui.toggleSideBySide()
            } else if (matchAction(event, 'inspect.before') && !event.repeat) {
                event.preventDefault()
                ui.engine?.setEditState(null)
            } else if (matchAction(event, 'tool.crop')) {
                event.preventDefault()
                toggleCropMode()
            } else if (matchAction(event, 'tool.eyedropper')) {
                event.preventDefault()
                if (useEditStore.getState().isRaw) useUiStore.getState().setEyedropper(!useUiStore.getState().eyedropper)
            } else if (ui.cropEditMode) {
                if (event.code === KEYMAP.tool.aspect && event.shiftKey) {
                    event.preventDefault()
                    cycleAspect()
                } else if (event.code === KEYMAP.tool.swap) {
                    event.preventDefault()
                    swapCropAspect()
                } else if (event.code === KEYMAP.tool.overlay) {
                    event.preventDefault()
                    useUiStore.getState().cycleCropOverlay()
                }
            } else if (matchAction(event, 'organize.flagReject')) {
                event.preventDefault()
                useOrganize.getState().setFlag(organizeTargets(), 'reject')
                if (event.shiftKey) advanceToNextFiltered()
            }
        }
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.code === resolveBinding('inspect.before').code) useUiStore.getState().engine?.setEditState(useEditStore.getState().state)
        }
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('keyup', onKeyUp)
        return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('keyup', onKeyUp)
        }
    }, [])

    useEffect(() => {
        if (getCurrentWindow().label !== 'main') return
        let disposed = false
        const unlisteners: Array<() => void> = []
        const handle = (payload: { path: string }) => {
            if (useSettings.getState().openInNewWindow) openInNewWindow(payload.path).catch(() => undefined)
            else handleOpenRef.current(payload.path)
        }
        onOpenRequest(handle)
            .then((dispose) => (disposed ? dispose() : unlisteners.push(dispose)))
            .catch(() => undefined)
        onDockOpen(handle)
            .then((dispose) => (disposed ? dispose() : unlisteners.push(dispose)))
            .catch(() => undefined)
        return () => {
            disposed = true
            for (const unlisten of unlisteners) unlisten()
        }
    }, [])

    useEffect(() => {
        usePresetStore.getState().load()
    }, [])

    useEffect(() => {
        if (!currentImageId) {
            useMeta.getState().clear()
            useLens.getState().clear()
            return
        }
        const timer = setTimeout(() => {
            useMeta.getState().loadForImage(currentImageId)
            useLens.getState().loadForImage(currentImageId)
        }, META_LOAD_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [currentImageId])

    useEffect(() => {
        const run = async () => {
            const state = usePlaylist.getState()
            const current = state.entries[state.currentIndex]
            if (!current) return
            const edit = useEditStore.getState()
            if (edit.imageId && edit.imageId !== current.imageId) await edit.flushPending()
            const nav = neighbors(state.entries, state.currentIndex, useSettings.getState().preloadRadius)
            await navigate(current.imageId, nav.prevIds, nav.nextIds).catch(() => undefined)
            if (useEditStore.getState().imageId !== current.imageId) await useEditStore.getState().loadForImage(current.imageId, current.isRaw)
        }
        run().catch(() => undefined)
    }, [currentImageId, scanning])

    useEffect(() => {
        let disposed = false
        let unlisten: (() => void) | null = null
        const sync = () =>
            fullscreenState()
                .then((on) => useUiStore.getState().setFullscreen(on))
                .catch(() => undefined)
        getCurrentWindow()
            .onResized(() => sync())
            .then((dispose) => (disposed ? dispose() : (unlisten = dispose)))
            .catch(() => undefined)
        return () => {
            disposed = true
            unlisten?.()
        }
    }, [])

    useEffect(() => {
        let disposed = false
        let unlisten: (() => void) | null = null
        onDecodeCrashLoop(() => {
            if (!useSettings.getState().isolatedDecode) setCrashLoopVisible(true)
        })
            .then((dispose) => (disposed ? dispose() : (unlisten = dispose)))
            .catch(() => undefined)
        return () => {
            disposed = true
            unlisten?.()
        }
    }, [])

    useEffect(() => {
        const evaluate = () => {
            if (useSettings.getState().l2Policy !== 'zoom') return
            const { model, clientW, clientH, imageId } = useViewportProjection.getState()
            if (!model || !imageId) {
                l2ZoomRef.current = null
                return
            }
            const best = usePlaylist.getState().best[imageId]
            if (!best || best.level === 'l2' || best.width <= 0) return
            const percent = zoomRatio(model, clientW, clientH, best.width)
            if (percent >= L2_ZOOM_ENTER_RATIO) {
                if (l2ZoomRef.current !== imageId) {
                    l2ZoomRef.current = imageId
                    requestL2(imageId).catch(() => undefined)
                }
            } else if (percent < L2_ZOOM_EXIT_RATIO && l2ZoomRef.current === imageId) {
                l2ZoomRef.current = null
            }
        }
        evaluate()
        return useViewportProjection.subscribe(evaluate)
    }, [])

    if (entryCount === 0)
        return (
            <main className='flex h-screen w-screen select-none flex-col items-center justify-center gap-6 bg-viewport text-neutral-300'>
                <div className='text-center'>
                    <h1 className='text-xl font-semibold'>raw-viewer</h1>
                    <p className='mt-2 text-sm text-neutral-400'>{t('app.dropHint')}</p>
                </div>
                <form
                    onSubmit={(event) => {
                        event.preventDefault()
                        if (pathInput.trim()) handleOpen(pathInput.trim())
                    }}
                    className='flex w-full max-w-lg gap-2 px-6'>
                    <input
                        value={pathInput}
                        onChange={(event) => setPathInput(event.target.value)}
                        placeholder={t('app.pathPlaceholder')}
                        className='flex-1 rounded border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-neutral-400'
                    />
                    <button
                        type='button'
                        onClick={pickAndOpen}
                        className='rounded border border-neutral-600 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800'>
                        {t('app.pickFile')}
                    </button>
                    <button type='submit' className='rounded bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white'>
                        {t('app.open')}
                    </button>
                </form>
                {openError && <p className='px-6 text-xs text-red-400'>{openError}</p>}
            </main>
        )

    return (
        <main className='relative flex h-screen w-screen select-none flex-col bg-viewport'>
            <div className='flex min-h-0 flex-1'>
                <div className='relative min-w-0 flex-1' onContextMenu={openContextMenu}>
                    <Viewport />
                    {scanning && (
                        <div className='absolute bottom-3 left-3 rounded bg-black/60 px-2.5 py-1 text-xs text-neutral-300'>
                            {total > 0 ? t('app.scanningTotal', { count: entryCount, total }) : t('app.scanning', { count: entryCount })}
                        </div>
                    )}
                    {selectionCount > 1 && (
                        <button
                            type='button'
                            onClick={() => useEditClipboard.getState().syncSelection(usePlaylist.getState().selection)}
                            className='absolute bottom-3 right-3 rounded bg-neutral-200/90 px-3 py-1 text-xs font-medium text-neutral-900 shadow hover:bg-white'>
                            {t('app.syncSelection', { count: selectionCount })}
                        </button>
                    )}
                    <PerfOverlay visible={false} />
                    {gridActive && <GridView />}
                </div>
                {rightPanel !== 'none' && !isFullscreen && (
                    <div className='flex h-full w-80 shrink-0 flex-col'>
                        <div className='flex shrink-0 border-b border-l border-neutral-800 bg-neutral-900 text-[11px]'>
                            {PANEL_TABS.map((id) => (
                                <button
                                    key={id}
                                    type='button'
                                    onClick={() => useLayout.getState().selectRightPanel(id)}
                                    className={`flex-1 py-1.5 ${rightPanel === id ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>
                                    {t(`app.tab.${id}`)}
                                </button>
                            ))}
                        </div>
                        <div className='flex min-h-0 flex-1'>
                            {rightPanel === 'edit' && <EditPanel />}
                            {rightPanel === 'meta' && <MetaPanel />}
                            {rightPanel === 'preset' && <PresetPanel />}
                            {rightPanel === 'history' && <HistoryPanel />}
                        </div>
                    </div>
                )}
            </div>
            {filmstripVisible && !isFullscreen && (
                <div className='flex shrink-0 flex-col'>
                    <FilmstripResizer />
                    <FilterBar />
                    <div style={{ height: filmstripHeight }}>
                        <Filmstrip />
                    </div>
                </div>
            )}
            {!isFullscreen && <StatusBar />}
            {crashLoopVisible && (
                <div
                    role='alert'
                    className='absolute left-1/2 top-3 z-[70] flex w-[min(32rem,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-md border border-amber-500/40 bg-neutral-900/95 px-4 py-2.5 text-xs text-neutral-200 shadow-lg'>
                    <span className='min-w-0 flex-1 leading-snug'>{t('crashLoop.message')}</span>
                    <button
                        type='button'
                        onClick={openIsolationSettings}
                        className='shrink-0 rounded bg-neutral-200 px-2.5 py-1 font-medium text-neutral-900 hover:bg-white'>
                        {t('crashLoop.openSettings')}
                    </button>
                    <button
                        type='button'
                        onClick={() => setCrashLoopVisible(false)}
                        className='shrink-0 rounded border border-neutral-600 px-2.5 py-1 text-neutral-300 hover:bg-neutral-800'>
                        {t('crashLoop.dismiss')}
                    </button>
                </div>
            )}
            {toastMessage && (
                <div className='pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded bg-black/80 px-3 py-1.5 text-xs text-neutral-100 shadow-lg'>
                    {toastMessage}
                </div>
            )}
            <div aria-live='polite' className='sr-only'>
                {currentName ? t('app.ariaPosition', { position: currentPosition + 1, total: entryCount, name: currentName }) : ''}
            </div>
            <ContextMenu />
            <ExportDialog />
            <SettingsDialog />
            <AboutDialog />
            <CommandPalette onOpenFile={pickAndOpen} onOpenPath={(path) => handleOpenRef.current(path)} />
        </main>
    )
}
