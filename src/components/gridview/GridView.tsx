import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import type { FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { isEditableTarget } from '../../shortcuts/keymap'
import { openEntryContext, selectEntryAt } from '../listSelection'
import { isFilterActive, useFilter } from '../../store/filter'
import { useGridView } from '../../store/gridView'
import { useOrganize } from '../../store/organize'
import { isOverlayBlocking } from '../../store/overlays'
import { usePairs } from '../../store/pairs'
import { usePlaylist } from '../../store/playlist'
import { GRID_CELL_MAX, GRID_CELL_MIN, useSettings } from '../../store/settings'
import { GridCell } from './GridCell'

const activeList = () => {
    const playlist = usePlaylist.getState()
    return playlist.filteredIndices.length > 0 || isFilterActive(useFilter.getState())
        ? playlist.filteredIndices
        : playlist.entries.map((_, index) => index)
}

export const GridView: FC = () => {
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const colsRef = useRef(1)
    const [width, setWidth] = useState(0)
    const { t } = useTranslation()

    const jpegByRaw = usePairs((state) => state.jpegByRaw)
    const entries = usePlaylist((state) => state.entries)
    const currentIndex = usePlaylist((state) => state.currentIndex)
    const filteredIndices = usePlaylist((state) => state.filteredIndices)
    const selection = usePlaylist((state) => state.selection)
    const best = usePlaylist((state) => state.best)
    const organize = useOrganize((state) => state.entries)
    const edited = useOrganize((state) => state.edited)
    const filterActive = useFilter((state) => isFilterActive(state))
    const cellSize = useSettings((state) => state.gridCellSize)

    const list = filteredIndices.length > 0 || filterActive ? filteredIndices : entries.map((_, index) => index)
    const currentPos = list.indexOf(currentIndex)
    const selectionSet = new Set(selection)
    const cols = Math.max(1, Math.floor(width / cellSize))
    colsRef.current = cols
    const rowCount = Math.ceil(list.length / cols)
    const rowHeight = width > 0 ? width / cols : cellSize

    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => rowHeight,
        overscan: 4,
    })

    const openLoupe = (entryIndex: number) => {
        usePlaylist.getState().focusIndex(entryIndex)
        useGridView.getState().close()
    }

    const handleSelect = (visiblePos: number, entryIndex: number, event: MouseEvent) => selectEntryAt(list, entries, visiblePos, entryIndex, event)

    const handleContext = (entryIndex: number, event: MouseEvent) => {
        event.stopPropagation()
        openEntryContext(entries, entryIndex, event)
    }

    useEffect(() => {
        const element = scrollRef.current
        if (!element) return
        setWidth(element.clientWidth)
        const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        virtualizer.measure()
    }, [rowHeight, virtualizer])

    useEffect(() => {
        if (cols > 0 && currentPos >= 0) virtualizer.scrollToIndex(Math.floor(currentPos / cols), { align: 'auto' })
    }, [currentPos, cols, virtualizer])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (isEditableTarget(document.activeElement) || event.metaKey || isOverlayBlocking()) return
            if (event.code === 'Escape') {
                event.preventDefault()
                useGridView.getState().close()
                return
            }
            const current = activeList()
            if (current.length === 0) return
            const position = Math.max(0, current.indexOf(usePlaylist.getState().currentIndex))
            const columns = colsRef.current
            let next: number | null = null
            if (event.code === 'ArrowLeft') next = position - 1
            else if (event.code === 'ArrowRight') next = position + 1
            else if (event.code === 'ArrowUp') next = position - columns
            else if (event.code === 'ArrowDown') next = position + columns
            else if (event.code === 'Home') next = 0
            else if (event.code === 'End') next = current.length - 1
            else if (event.code === 'Enter') {
                event.preventDefault()
                useGridView.getState().close()
                return
            }
            if (next === null) return
            event.preventDefault()
            usePlaylist.getState().focusIndex(current[Math.max(0, Math.min(current.length - 1, next))])
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    return (
        <div
            className='absolute inset-0 z-20 flex flex-col bg-neutral-900'
            onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
            }}>
            <div className='flex shrink-0 items-center justify-between gap-4 border-b border-neutral-800 px-3 py-2'>
                <span className='text-xs text-neutral-400'>{t('grid.count', { count: list.length })}</span>
                <div className='flex items-center gap-2'>
                    <span className='text-[10px] text-neutral-500'>{t('grid.cellSize')}</span>
                    <input
                        type='range'
                        min={GRID_CELL_MIN}
                        max={GRID_CELL_MAX}
                        step={10}
                        value={cellSize}
                        onChange={(event) => useSettings.getState().setGridCellSize(Number(event.target.value))}
                        onPointerUp={() => useSettings.getState().commitGridCellSize()}
                        onBlur={() => useSettings.getState().commitGridCellSize()}
                        aria-label={t('grid.cellSize')}
                        className='w-32 accent-neutral-300'
                    />
                    <button
                        type='button'
                        onClick={() => useGridView.getState().close()}
                        aria-label={t('grid.exit')}
                        className='rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800'>
                        {t('grid.exit')}
                    </button>
                </div>
            </div>
            <div ref={scrollRef} className='min-h-0 flex-1 overflow-y-auto px-1'>
                {list.length === 0 ? (
                    <div className='flex h-full items-center justify-center text-xs text-neutral-600'>
                        {filterActive ? t('filmstrip.noFilterResults') : ''}
                    </div>
                ) : (
                    <div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
                        {virtualizer.getVirtualItems().map((row) => {
                            const start = row.index * cols
                            const rowEntries = list.slice(start, start + cols)
                            return (
                                <div
                                    key={row.key}
                                    className='absolute left-0 top-0 grid w-full'
                                    style={{
                                        height: rowHeight,
                                        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                                        transform: `translateY(${row.start}px)`,
                                    }}>
                                    {rowEntries.map((entryIndex, offset) => {
                                        const entry = entries[entryIndex]
                                        if (!entry) return null
                                        const meta = organize[entry.imageId]
                                        return (
                                            <GridCell
                                                key={entry.imageId}
                                                entry={entry}
                                                active={entryIndex === currentIndex}
                                                selected={selectionSet.has(entry.imageId)}
                                                rating={meta?.rating ?? 0}
                                                flag={meta?.flag ?? null}
                                                label={meta?.label ?? null}
                                                edited={edited[entry.imageId] ?? false}
                                                paired={jpegByRaw[entry.imageId] !== undefined}
                                                rev={best[entry.imageId]?.rev}
                                                onSelect={(event) => handleSelect(start + offset, entryIndex, event)}
                                                onOpen={() => openLoupe(entryIndex)}
                                                onContextMenu={(event) => handleContext(entryIndex, event)}
                                            />
                                        )
                                    })}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
