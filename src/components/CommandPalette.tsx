import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalDismiss } from '../lib/useModalDismiss'
import { buildActions, recentActions } from '../shortcuts/actions'
import { getRecents } from '../ipc/platform'
import { useOverlays } from '../store/overlays'
import type { PaletteAction } from '../shortcuts/actions'
import type { RecentEntry } from '../types/RecentEntry'

type CommandPaletteProps = { onOpenFile: () => void; onOpenPath: (path: string) => void }

const fuzzyScore = (query: string, text: string) => {
    const q = query.toLowerCase()
    const s = text.toLowerCase()
    let qi = 0
    let score = 0
    let last = -2
    for (let si = 0; si < s.length && qi < q.length; si++) {
        if (s[si] !== q[qi]) continue
        score += 1
        if (last === si - 1) score += 2
        if (si === 0 || s[si - 1] === ' ' || s[si - 1] === '·') score += 3
        last = si
        qi++
    }
    return qi === q.length ? score : -1
}

const rank = (query: string, action: PaletteAction) => {
    if (!query) return 0
    const fields = [action.title, action.keywords ?? '', action.group]
    let best = -1
    for (const field of fields) best = Math.max(best, fuzzyScore(query, field))
    return best
}

const PaletteDialog: FC<CommandPaletteProps> = ({ onOpenFile, onOpenPath }) => {
    const dialogRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    const { t } = useTranslation()
    const [query, setQuery] = useState('')
    const [index, setIndex] = useState(0)
    const [recents, setRecents] = useState<RecentEntry[]>([])

    const close = () => useOverlays.getState().closePalette()

    const all = [...buildActions(t, { openFile: onOpenFile }), ...recentActions(t, recents, onOpenPath)]
    const results = all
        .map((action) => ({ action, score: rank(query, action) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.action)

    const clamped = results.length === 0 ? 0 : Math.min(index, results.length - 1)

    const runAt = (position: number) => {
        const action = results[position]
        if (!action) return
        close()
        action.run()
    }

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault()
            setIndex((value) => (results.length === 0 ? 0 : (value + 1) % results.length))
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setIndex((value) => (results.length === 0 ? 0 : (value - 1 + results.length) % results.length))
        } else if (event.key === 'Enter') {
            event.preventDefault()
            runAt(clamped)
        }
    }

    useEffect(() => {
        getRecents()
            .then(setRecents)
            .catch(() => setRecents([]))
    }, [])

    useEffect(() => {
        listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    }, [clamped, query])

    useModalDismiss(dialogRef, close)

    return (
        <div className='fixed inset-0 z-[65] flex items-start justify-center bg-black/50 pt-[12vh]' onClick={close}>
            <div
                ref={dialogRef}
                role='dialog'
                aria-modal='true'
                aria-label={t('palette.placeholder')}
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
                className='flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 shadow-2xl outline-none'>
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value)
                        setIndex(0)
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={t('palette.placeholder')}
                    aria-label={t('palette.placeholder')}
                    spellCheck={false}
                    className='shrink-0 border-b border-neutral-800 bg-transparent px-4 py-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600'
                />
                <div ref={listRef} className='min-h-0 flex-1 overflow-y-auto py-1'>
                    {results.length === 0 ? (
                        <div className='px-4 py-6 text-center text-xs text-neutral-500'>{t('palette.empty')}</div>
                    ) : (
                        results.map((action, position) => (
                            <button
                                key={action.id}
                                type='button'
                                data-selected={position === clamped}
                                onMouseMove={() => setIndex(position)}
                                onClick={() => runAt(position)}
                                className={`flex w-full items-center justify-between gap-4 px-4 py-1.5 text-left text-xs ${
                                    position === clamped ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-800/50'
                                }`}>
                                <span className='min-w-0 truncate'>{action.title}</span>
                                <span className='shrink-0 text-[10px] text-neutral-500'>{action.group}</span>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}

export const CommandPalette: FC<CommandPaletteProps> = ({ onOpenFile, onOpenPath }) => {
    const open = useOverlays((state) => state.paletteOpen)
    return open ? <PaletteDialog onOpenFile={onOpenFile} onOpenPath={onOpenPath} /> : null
}
