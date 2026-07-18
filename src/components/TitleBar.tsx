import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { toggleFullscreen } from '../ipc/commands'
import { useDismissOnOutside } from '../lib/useDismissOnOutside'
import { useModalDismiss } from '../lib/useModalDismiss'
import { useLayout } from '../store/layout'
import { useOverlays } from '../store/overlays'
import { usePlaylist } from '../store/playlist'
import { usePresetStore } from '../store/presetStore'
import { useExportStore } from '../store/exportStore'
import { useUiStore } from '../store/uiStore'

type TitleBarProps = { onOpenFile: () => void }

export const TitleBar: FC<TitleBarProps> = ({ onOpenFile }) => {
    const menuRef = useRef<HTMLDivElement | null>(null)
    const uiMenuRef = useRef<HTMLDivElement | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [uiMenuOpen, setUiMenuOpen] = useState(false)
    const [maximized, setMaximized] = useState(false)
    const { t } = useTranslation()

    const rightPanel = useLayout((state) => state.rightPanel)
    const filmstripVisible = useLayout((state) => state.filmstripVisible)
    const quickBarVisible = useLayout((state) => state.quickBarVisible)
    const statusBarVisible = useLayout((state) => state.statusBarVisible)
    const viewerPillVisible = useLayout((state) => state.viewerPillVisible)
    const perfVisible = useUiStore((state) => state.perfVisible)

    const openExport = () => {
        const playlist = usePlaylist.getState()
        const current = playlist.entries[playlist.currentIndex]
        if (!current) return
        const targets = playlist.selection.length > 1 ? playlist.selection : [current.imageId]
        useExportStore.getState().openDialog(targets)
    }

    const runMenu = (action: () => void) => {
        setMenuOpen(false)
        action()
    }

    useModalDismiss(menuRef, () => setMenuOpen(false))
    useDismissOnOutside(menuRef, menuOpen, () => setMenuOpen(false))
    useDismissOnOutside(uiMenuRef, uiMenuOpen, () => setUiMenuOpen(false))
    useEffect(() => {
        let disposed = false
        let unlisten: (() => void) | null = null
        const sync = () =>
            getCurrentWindow()
                .isMaximized()
                .then((value) => setMaximized(value))
                .catch(() => undefined)
        sync()
        getCurrentWindow()
            .onResized(() => sync())
            .then((dispose) => (disposed ? dispose() : (unlisten = dispose)))
            .catch(() => undefined)
        return () => {
            disposed = true
            unlisten?.()
        }
    }, [])

    return (
        <header
            data-tauri-drag-region
            className='relative z-[45] flex h-9 shrink-0 select-none items-center border-b border-neutral-800 bg-neutral-900 pl-3 text-xs text-neutral-300'>
            <span className='pointer-events-none font-medium text-neutral-200'>Raw Viewer</span>
            <div ref={menuRef} className='relative ml-3'>
                <button
                    type='button'
                    onClick={() => setMenuOpen((open) => !open)}
                    onMouseEnter={() => uiMenuOpen && (setUiMenuOpen(false), setMenuOpen(true))}
                    title={t('titlebar.menu')}
                    aria-label={t('titlebar.menu')}
                    aria-expanded={menuOpen}
                    className={`rounded px-2 py-1 hover:bg-neutral-800 ${menuOpen ? 'bg-neutral-800 text-neutral-100' : ''}`}>
                    {t('titlebar.menu')}
                </button>
                {menuOpen && (
                    <div
                        role='menu'
                        className='absolute left-0 top-full z-50 mt-1 w-52 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl'>
                        <MenuEntry onClick={() => runMenu(onOpenFile)} shortcut='⌘O'>
                            {t('titlebar.openFile')}
                        </MenuEntry>
                        <MenuEntry onClick={() => runMenu(openExport)} shortcut='⌘E'>
                            {t('titlebar.export')}
                        </MenuEntry>
                        <MenuEntry onClick={() => runMenu(() => usePresetStore.getState().importFromFile())}>{t('titlebar.importPreset')}</MenuEntry>
                        <div role='separator' className='my-1 border-t border-neutral-800' />
                        <MenuEntry
                            onClick={() =>
                                runMenu(() =>
                                    toggleFullscreen()
                                        .then((on) => useUiStore.getState().setFullscreen(on))
                                        .catch(() => undefined),
                                )
                            }
                            shortcut='F'>
                            {t('titlebar.fullscreen')}
                        </MenuEntry>
                        <MenuEntry onClick={() => runMenu(() => useOverlays.getState().openSettings())} shortcut='⌘,'>
                            {t('titlebar.settings')}
                        </MenuEntry>
                        <MenuEntry onClick={() => runMenu(() => useOverlays.getState().openAbout())}>{t('titlebar.about')}</MenuEntry>
                    </div>
                )}
            </div>
            <div ref={uiMenuRef} className='relative ml-1'>
                <button
                    type='button'
                    onClick={() => setUiMenuOpen((open) => !open)}
                    onMouseEnter={() => menuOpen && (setMenuOpen(false), setUiMenuOpen(true))}
                    title={t('titlebar.uiMenu')}
                    aria-label={t('titlebar.uiMenu')}
                    aria-expanded={uiMenuOpen}
                    className={`rounded px-2 py-1 hover:bg-neutral-800 ${uiMenuOpen ? 'bg-neutral-800 text-neutral-100' : ''}`}>
                    {t('titlebar.uiMenu')}
                </button>
                {uiMenuOpen && (
                    <div
                        role='menu'
                        className='absolute left-0 top-full z-50 mt-1 w-52 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl'>
                        <MenuEntry checked={rightPanel !== 'none'} onClick={() => useLayout.getState().toggleRightPanel()}>
                            {t('titlebar.uiRightPanel')}
                        </MenuEntry>
                        <MenuEntry checked={filmstripVisible} onClick={() => useLayout.getState().toggleFilmstrip()}>
                            {t('titlebar.uiFilmstrip')}
                        </MenuEntry>
                        <MenuEntry checked={statusBarVisible} onClick={() => useLayout.getState().toggleStatusBar()}>
                            {t('titlebar.uiStatusBar')}
                        </MenuEntry>
                        <MenuEntry checked={quickBarVisible} onClick={() => useLayout.getState().toggleQuickBar()}>
                            {t('titlebar.uiQuickBar')}
                        </MenuEntry>
                        <MenuEntry checked={viewerPillVisible} onClick={() => useLayout.getState().toggleViewerPill()}>
                            {t('titlebar.uiViewerPill')}
                        </MenuEntry>
                        <div role='separator' className='my-1 border-t border-neutral-800' />
                        <MenuEntry checked={perfVisible} onClick={() => useUiStore.getState().togglePerfOverlay()}>
                            {t('titlebar.uiPerfOverlay')}
                        </MenuEntry>
                    </div>
                )}
            </div>
            <div className='ml-auto flex h-full items-stretch'>
                <button
                    type='button'
                    onClick={() =>
                        getCurrentWindow()
                            .minimize()
                            .catch(() => undefined)
                    }
                    title={t('titlebar.minimize')}
                    aria-label={t('titlebar.minimize')}
                    className='flex w-11 items-center justify-center hover:bg-neutral-800'>
                    <span className='block h-px w-3 bg-current' />
                </button>
                <button
                    type='button'
                    onClick={() =>
                        getCurrentWindow()
                            .toggleMaximize()
                            .catch(() => undefined)
                    }
                    title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
                    aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
                    className='flex w-11 items-center justify-center hover:bg-neutral-800'>
                    <span className={`block border border-current ${maximized ? 'h-2.5 w-2.5' : 'h-3 w-3'}`} />
                </button>
                <button
                    type='button'
                    onClick={() =>
                        getCurrentWindow()
                            .close()
                            .catch(() => undefined)
                    }
                    title={t('titlebar.close')}
                    aria-label={t('titlebar.close')}
                    className='flex w-11 items-center justify-center text-sm hover:bg-red-600 hover:text-white'>
                    ✕
                </button>
            </div>
        </header>
    )
}

type MenuEntryProps = { onClick: () => void; shortcut?: string; checked?: boolean; children: React.ReactNode }

const MenuEntry: FC<MenuEntryProps> = ({ onClick, shortcut, checked, children }) => (
    <button
        type='button'
        role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={checked}
        onClick={onClick}
        className='flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800'>
        <span className='flex items-center gap-2'>
            {checked !== undefined && (
                <span aria-hidden='true' className={`w-3 text-center ${checked ? 'text-sky-400' : 'text-transparent'}`}>
                    ✓
                </span>
            )}
            {children}
        </span>
        {shortcut && <span className='text-[10px] text-neutral-500'>{shortcut}</span>}
    </button>
)
