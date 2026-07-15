import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useMeta } from '../store/meta'
import { usePlaylist } from '../store/playlist'
import { formatAperture, formatBytes, formatShutter } from './panels/MetaPanel/format'

export const StatusBar: FC = () => {
    const { t } = useTranslation()
    const entries = usePlaylist((state) => state.entries)
    const currentIndex = usePlaylist((state) => state.currentIndex)
    const filteredIndices = usePlaylist((state) => state.filteredIndices)
    const best = usePlaylist((state) => state.best)
    const selection = usePlaylist((state) => state.selection)
    const metadata = useMeta((state) => state.metadata)

    const current = entries[currentIndex]
    if (!current) return null

    const list = filteredIndices.length > 0 ? filteredIndices : entries.map((_, index) => index)
    const position = list.indexOf(currentIndex)
    const positionText = `${(position < 0 ? currentIndex : position) + 1}/${list.length || entries.length}`

    const level = best[current.imageId]
    const dimensions = level
        ? `${level.width}×${level.height}`
        : metadata?.file.width && metadata.file.height
          ? `${metadata.file.width}×${metadata.file.height}`
          : null
    const size = metadata?.file.sizeBytes ? formatBytes(metadata.file.sizeBytes) : null
    const exposure = metadata?.exposure
    const aperture = exposure?.fNumber != null ? formatAperture(exposure.fNumber) : null
    const shutter = exposure?.shutterSpeed ? formatShutter(exposure.shutterSpeed) : null
    const iso = exposure?.iso != null ? `ISO${exposure.iso}` : null

    const parts = [positionText, dimensions, size, [aperture, shutter, iso].filter(Boolean).join(' ') || null].filter(Boolean)

    return (
        <footer className='flex h-7 shrink-0 items-center gap-2 border-t border-neutral-800 bg-neutral-900 px-3 text-[11px] text-neutral-400'>
            <span className='truncate text-neutral-300'>{current.fileName}</span>
            <span className='text-neutral-600'>·</span>
            <span className='truncate'>{parts.join(' · ')}</span>
            {selection.length > 1 && (
                <span className='ml-auto shrink-0 text-neutral-500'>{t('status.selectedCount', { count: selection.length })}</span>
            )}
        </footer>
    )
}
