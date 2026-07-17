import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { toggleFullscreen } from '../ipc/commands'
import { useModalDismiss } from '../lib/useModalDismiss'
import { useOverlays } from '../store/overlays'
import { usePlaylist } from '../store/playlist'
import { usePresetStore } from '../store/presetStore'
import { useExportStore } from '../store/exportStore'
import { useUiStore } from '../store/uiStore'

type TitleBarProps = { onOpenFile: () => void }

export const TitleBar: FC<TitleBarProps> = ({ onOpenFile }) => {
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [maximized, setMaximized] = useState(false)
    const { t } = useTranslation()

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
            <span className='pointer-events-none font-medium text-neutral-200'>raw-viewer</span>
            <div ref={menuRef} className='relative ml-3'>
                <button
                    type='button'
                    onClick={() => setMenuOpen((open) => !open)}
                    title={t('titlebar.menu')}
                    aria-label={t('titlebar.menu')}
                    aria-expanded={menuOpen}
                    className={`rounded px-2 py-1 hover:bg-neutral-800 ${menuOpen ? 'bg-neutral-800 text-neutral-100' : ''}`}>
                    {t('titlebar.menu')}
                </button>
                {menuOpen && (
                    <div className='absolute left-0 top-full z-50 mt-1 w-52 rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl'>
                        <MenuEntry onClick={() => runMenu(onOpenFile)} shortcut='⌘O'>
                            {t('titlebar.openFile')}
                        </MenuEntry>
                        <MenuEntry onClick={() => runMenu(openExport)} shortcut='⌘E'>
                            {t('titlebar.export')}
                        </MenuEntry>
                        <MenuEntry onClick={() => runMenu(() => usePresetStore.getState().importFromFile())}>{t('titlebar.importPreset')}</MenuEntry>
                        <div className='my-1 border-t border-neutral-800' />
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

type MenuEntryProps = { onClick: () => void; shortcut?: string; children: React.ReactNode }

const MenuEntry: FC<MenuEntryProps> = ({ onClick, shortcut, children }) => (
    <button
        type='button'
        onClick={onClick}
        className='flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800'>
        <span>{children}</span>
        {shortcut && <span className='text-[10px] text-neutral-500'>{shortcut}</span>}
    </button>
)
