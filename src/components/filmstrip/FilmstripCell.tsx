import { useEffect, useState } from 'react'
import type { CSSProperties, FC, MouseEvent } from 'react'
import { aetherUrl } from '../../ipc/pixels'
import { labelColor } from '../../store/organize'
import type { Flag } from '../../types/Flag'
import type { ImageEntry } from '../../types/ImageEntry'

type FilmstripCellProps = {
    entry: ImageEntry
    active: boolean
    selected: boolean
    rating: number
    flag: Flag | null
    label: string | null
    edited: boolean
    rev: number | undefined
    style: CSSProperties
    onSelect: (event: MouseEvent) => void
    onContextMenu: (event: MouseEvent) => void
}

export const FilmstripCell: FC<FilmstripCellProps> = ({
    entry,
    active,
    selected,
    rating,
    flag,
    label,
    edited,
    rev,
    style,
    onSelect,
    onContextMenu,
}) => {
    const [failed, setFailed] = useState(false)

    const src = `${aetherUrl(`pixels/${entry.imageId}/l0`)}${rev ? `?rev=${rev}` : ''}`
    const border = labelColor(label)

    useEffect(() => setFailed(false), [src])

    return (
        <div style={style} className='p-1'>
            <div
                onClick={onSelect}
                onContextMenu={onContextMenu}
                style={border ? { boxShadow: `inset 0 0 0 2px ${border}` } : undefined}
                className={`relative flex h-full cursor-pointer flex-col overflow-hidden rounded ${active ? 'ring-2 ring-sky-400' : selected ? 'ring-2 ring-sky-400/40' : 'ring-1 ring-transparent hover:ring-neutral-600'}`}>
                <div className='relative min-h-0 flex-1 bg-neutral-950'>
                    {failed ? (
                        <div className='flex h-full items-center justify-center px-1 text-center text-[9px] leading-tight text-neutral-500'>
                            {entry.fileName}
                        </div>
                    ) : (
                        <img
                            src={src}
                            loading='lazy'
                            draggable={false}
                            alt=''
                            onError={() => setFailed(true)}
                            className='h-full w-full object-contain'
                        />
                    )}
                    {entry.isRaw && (
                        <span className='pointer-events-none absolute left-0.5 top-0.5 rounded bg-black/70 px-1 text-[8px] font-semibold text-sky-300'>
                            RAW
                        </span>
                    )}
                    {edited && (
                        <span className='pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400' title='편집됨' />
                    )}
                    {flag && (
                        <span
                            className={`pointer-events-none absolute bottom-0.5 left-0.5 text-[10px] ${flag === 'pick' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {flag === 'pick' ? '⚑' : '⚐'}
                        </span>
                    )}
                </div>
                <div className='shrink-0 bg-neutral-900/90 px-1 pb-0.5'>
                    {rating > 0 && (
                        <div className='text-center text-[8px] leading-none text-amber-400'>
                            {'★'.repeat(rating)}
                            <span className='text-neutral-700'>{'★'.repeat(5 - rating)}</span>
                        </div>
                    )}
                    <div className='truncate text-center text-[9px] text-neutral-400'>{entry.fileName}</div>
                </div>
            </div>
        </div>
    )
}
