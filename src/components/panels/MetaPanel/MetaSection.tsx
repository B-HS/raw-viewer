import type { FC, ReactNode } from 'react'
import { useMeta } from '../../../store/meta'
import { MetaRow } from './MetaRow'

export type MetaRowData = { label: string; value: string; mono?: boolean }

type MetaSectionProps = { id: string; title: string; rows?: MetaRowData[]; children?: ReactNode }

export const MetaSection: FC<MetaSectionProps> = ({ id, title, rows = [], children }) => {
    const collapsed = useMeta((state) => state.collapsed[id] ?? false)
    if (rows.length === 0 && !children) return null
    return (
        <section className='border-b border-neutral-800'>
            <button
                type='button'
                onClick={() => useMeta.getState().toggleSection(id)}
                className='flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 hover:bg-neutral-800/50'>
                <span>{title}</span>
                <span className='text-neutral-600'>{collapsed ? '▸' : '▾'}</span>
            </button>
            {!collapsed && (
                <div className='pb-1'>
                    {rows.map((row) => (
                        <MetaRow key={row.label} label={row.label} value={row.value} mono={row.mono} />
                    ))}
                    {children}
                </div>
            )}
        </section>
    )
}
