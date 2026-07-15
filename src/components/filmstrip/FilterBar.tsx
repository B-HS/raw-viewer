import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { isFilterActive, useFilter } from '../../store/filter'
import { LABELS } from '../../store/organize'
import { usePlaylist } from '../../store/playlist'

const RATINGS = [1, 2, 3, 4, 5]

export const FilterBar: FC = () => {
    const { t } = useTranslation()
    const filter = useFilter()
    const filteredCount = usePlaylist((state) => state.filteredIndices.length)
    const total = usePlaylist((state) => state.entries.length)
    const active = isFilterActive(filter)

    return (
        <div className='flex h-8 shrink-0 items-center gap-2 border-t border-neutral-800 bg-neutral-900 px-3 text-[11px] text-neutral-400'>
            <div className='flex items-center' role='group' aria-label={t('filter.ratingFilterAria')}>
                {RATINGS.map((value) => (
                    <button
                        key={value}
                        type='button'
                        aria-label={t('filter.ratingMinAria', { value })}
                        onClick={() => filter.setMinRating(value)}
                        className={`px-0.5 text-sm leading-none ${value <= filter.minRating ? 'text-amber-400' : 'text-neutral-600 hover:text-neutral-400'}`}>
                        ★
                    </button>
                ))}
            </div>
            <span className='text-neutral-700'>|</span>
            <button
                type='button'
                aria-label={t('filter.pickOnlyAria')}
                onClick={() => filter.setFlag('pick')}
                className={`rounded px-1.5 py-0.5 ${filter.flag === 'pick' ? 'bg-emerald-500/20 text-emerald-300' : 'hover:bg-neutral-800'}`}>
                ⚑
            </button>
            <button
                type='button'
                aria-label={t('filter.rejectOnlyAria')}
                onClick={() => filter.setFlag('reject')}
                className={`rounded px-1.5 py-0.5 ${filter.flag === 'reject' ? 'bg-red-500/20 text-red-300' : 'hover:bg-neutral-800'}`}>
                ⚐
            </button>
            <span className='text-neutral-700'>|</span>
            <div className='flex items-center gap-1' role='group' aria-label={t('filter.labelFilterAria')}>
                {LABELS.map((entry) => (
                    <button
                        key={entry.name}
                        type='button'
                        aria-label={t('filter.labelAria', { name: entry.name })}
                        onClick={() => filter.setLabel(entry.name)}
                        style={{ backgroundColor: entry.color }}
                        className={`h-3.5 w-3.5 rounded-full ${filter.label === entry.name ? 'ring-2 ring-white ring-offset-1 ring-offset-neutral-900' : 'opacity-60 hover:opacity-100'}`}
                    />
                ))}
            </div>
            <span className='text-neutral-700'>|</span>
            <button
                type='button'
                onClick={filter.toggleEditedOnly}
                className={`rounded px-1.5 py-0.5 ${filter.editedOnly ? 'bg-amber-500/20 text-amber-300' : 'hover:bg-neutral-800'}`}>
                {t('filter.editedOnly')}
            </button>
            <button
                type='button'
                onClick={filter.toggleRawOnly}
                className={`rounded px-1.5 py-0.5 ${filter.rawOnly ? 'bg-sky-500/20 text-sky-300' : 'hover:bg-neutral-800'}`}>
                {t('filter.rawOnly')}
            </button>
            <input
                value={filter.search}
                onChange={(event) => filter.setSearch(event.target.value)}
                placeholder={t('filter.searchPlaceholder')}
                aria-label={t('filter.searchAria')}
                className='ml-1 w-40 rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-500'
            />
            {active && (
                <>
                    <button
                        type='button'
                        onClick={filter.reset}
                        className='rounded px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200'>
                        {t('filter.reset')}
                    </button>
                    <span className='ml-auto shrink-0 text-neutral-500'>
                        {filteredCount}/{total}
                    </span>
                </>
            )}
        </div>
    )
}
