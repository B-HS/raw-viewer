import { useState } from 'react'
import type { FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { aetherUrl } from '../../ipc/pixels'
import { labelColor } from '../../store/organize'
import type { Flag } from '../../types/Flag'
import type { ImageEntry } from '../../types/ImageEntry'

type GridCellProps = {
    entry: ImageEntry
    active: boolean
    selected: boolean
    rating: number
    flag: Flag | null
    label: string | null
    edited: boolean
    paired: boolean
    rev: number | undefined
    onSelect: (event: MouseEvent) => void
    onOpen: () => void
    onContextMenu: (event: MouseEvent) => void
}

export const GridCell: FC<GridCellProps> = ({
    entry,
    active,
    selected,
    rating,
    flag,
    label,
    edited,
    paired,
    rev,
    onSelect,
    onOpen,
    onContextMenu,
}) => {
    const { t } = useTranslation()
    const [failedSrc, setFailedSrc] = useState<string | null>(null)

    const src = `${aetherUrl(`pixels/${entry.imageId}/l0`)}${rev ? `?rev=${rev}` : ''}`
    const failed = failedSrc === src
    const border = labelColor(label)

    return (
        <div className='p-1'>
            <button
                type='button'
                onClick={onSelect}
                onDoubleClick={onOpen}
                onContextMenu={onContextMenu}
                aria-label={entry.fileName}
                aria-pressed={selected}
                style={border ? { boxShadow: `inset 0 0 0 2px ${border}` } : undefined}
                className={`relative flex aspect-square w-full flex-col overflow-hidden rounded bg-neutral-950 outline-2 -outline-offset-2 ${active ? 'outline outline-sky-400' : selected ? 'outline outline-sky-400/40' : 'hover:outline hover:outline-neutral-600 focus-visible:outline focus-visible:outline-sky-400'}`}>
                {failed ? (
                    <span className='flex h-full items-center justify-center px-2 text-center text-[10px] leading-tight text-neutral-500'>
                        {entry.fileName}
                    </span>
                ) : (
                    <img src={src} loading='lazy' draggable={false} alt='' onError={() => setFailedSrc(src)} className='h-full w-full object-cover' />
                )}
                {entry.isRaw && (
                    <span className='pointer-events-none absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] font-semibold text-sky-300'>
                        {paired ? t('filmstrip.pairBadge') : 'RAW'}
                    </span>
                )}
                {edited && (
                    <span
                        className='pointer-events-none absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400'
                        title={t('filmstrip.editedTitle')}
                    />
                )}
                {flag && (
                    <span className={`pointer-events-none absolute left-1 top-6 text-xs ${flag === 'pick' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {flag === 'pick' ? '⚑' : '⚐'}
                    </span>
                )}
                {rating > 0 && (
                    <span className='pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-2 text-center text-[10px] leading-none text-amber-400'>
                        {'★'.repeat(rating)}
                        <span className='text-neutral-700'>{'★'.repeat(5 - rating)}</span>
                    </span>
                )}
            </button>
        </div>
    )
}
