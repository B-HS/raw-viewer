import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'
import type { FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { openEntryContext, selectEntryAt } from '../listSelection'
import { isFilterActive, useFilter } from '../../store/filter'
import { useOrganize } from '../../store/organize'
import { usePairs } from '../../store/pairs'
import { usePlaylist } from '../../store/playlist'
import { FilmstripCell } from './FilmstripCell'

const CELL_WIDTH = 88

export const Filmstrip: FC = () => {
    const { t } = useTranslation()
    const scrollRef = useRef<HTMLDivElement | null>(null)

    const jpegByRaw = usePairs((state) => state.jpegByRaw)
    const entries = usePlaylist((state) => state.entries)
    const currentIndex = usePlaylist((state) => state.currentIndex)
    const filteredIndices = usePlaylist((state) => state.filteredIndices)
    const selection = usePlaylist((state) => state.selection)
    const best = usePlaylist((state) => state.best)
    const organize = useOrganize((state) => state.entries)
    const edited = useOrganize((state) => state.edited)
    const filterActive = useFilter((state) => isFilterActive(state))

    const list = filteredIndices.length > 0 || filterActive ? filteredIndices : entries.map((_, index) => index)
    const currentPos = list.indexOf(currentIndex)
    const selectionSet = new Set(selection)

    const virtualizer = useVirtualizer({
        count: list.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => CELL_WIDTH,
        horizontal: true,
        overscan: 8,
    })

    const handleSelect = (visiblePos: number, entryIndex: number, event: MouseEvent) => selectEntryAt(list, entries, visiblePos, entryIndex, event)

    const handleContext = (entryIndex: number, event: MouseEvent) => openEntryContext(entries, entryIndex, event)

    useEffect(() => {
        const element = scrollRef.current
        if (!element) return
        const onWheel = (event: WheelEvent) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
            event.preventDefault()
            element.scrollLeft += event.deltaY
        }
        element.addEventListener('wheel', onWheel, { passive: false })
        return () => element.removeEventListener('wheel', onWheel)
    }, [])

    useEffect(() => {
        if (currentPos >= 0) virtualizer.scrollToIndex(currentPos, { align: 'center' })
    }, [currentPos, virtualizer])

    return (
        <div ref={scrollRef} className='h-full overflow-x-auto overflow-y-hidden bg-neutral-900'>
            {list.length === 0 ? (
                <div className='flex h-full items-center justify-center text-xs text-neutral-600'>
                    {filterActive ? t('filmstrip.noFilterResults') : ''}
                </div>
            ) : (
                <div className='relative h-full' style={{ width: virtualizer.getTotalSize() }}>
                    {virtualizer.getVirtualItems().map((item) => {
                        const entryIndex = list[item.index]
                        const entry = entries[entryIndex]
                        if (!entry) return null
                        const meta = organize[entry.imageId]
                        return (
                            <FilmstripCell
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
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    height: '100%',
                                    width: CELL_WIDTH,
                                    transform: `translateX(${item.start}px)`,
                                }}
                                onSelect={(event) => handleSelect(item.index, entryIndex, event)}
                                onContextMenu={(event) => handleContext(entryIndex, event)}
                            />
                        )
                    })}
                </div>
            )}
        </div>
    )
}
