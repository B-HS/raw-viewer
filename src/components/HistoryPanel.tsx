import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditStore } from '../store/editStore'
import { useHistoryStore } from '../store/historyStore'

type Row = { label: string; timestamp: number | null; target: number }

export const HistoryPanel: FC = () => {
    const activeRef = useRef<HTMLButtonElement | null>(null)
    const { t, i18n } = useTranslation()
    const imageId = useEditStore((state) => state.imageId)
    const stacks = useHistoryStore((state) => state.stacks)

    const stack = imageId ? stacks[imageId] : undefined
    const timeline = stack ? [...stack.undo, ...[...stack.redo].reverse()] : []
    const current = stack ? stack.undo.length - 1 : -1
    const rows: Row[] = [
        { label: t('history.original'), timestamp: null, target: -1 },
        ...timeline.map((entry, index) => ({ label: entry.label, timestamp: entry.timestamp, target: index })),
    ]
    const formatTime = (value: number) =>
        new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value)

    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: 'nearest' })
    }, [current, imageId])

    return (
        <div className='flex min-h-0 flex-1 flex-col border-l border-neutral-800 bg-neutral-900'>
            <div className='shrink-0 border-b border-neutral-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500'>
                {t('history.title')}
            </div>
            {rows.length <= 1 ? (
                <div className='flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-600'>{t('history.empty')}</div>
            ) : (
                <ul className='min-h-0 flex-1 overflow-y-auto py-1' aria-label={t('history.title')}>
                    {rows
                        .slice()
                        .reverse()
                        .map((row) => {
                            const active = row.target === current
                            return (
                                <li key={row.target}>
                                    <button
                                        ref={active ? activeRef : undefined}
                                        type='button'
                                        aria-current={active}
                                        onClick={() => imageId && useHistoryStore.getState().jumpTo(imageId, row.target)}
                                        className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs ${active ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800/50'}`}>
                                        <span className='flex min-w-0 items-center gap-2'>
                                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-sky-400' : 'bg-transparent'}`} />
                                            <span className='truncate'>{row.label}</span>
                                        </span>
                                        {row.timestamp !== null && (
                                            <span className='shrink-0 font-mono text-[10px] text-neutral-600'>{formatTime(row.timestamp)}</span>
                                        )}
                                    </button>
                                </li>
                            )
                        })}
                </ul>
            )}
        </div>
    )
}
