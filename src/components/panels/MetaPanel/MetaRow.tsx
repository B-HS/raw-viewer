import type { FC, MouseEvent } from 'react'
import { useToast } from '../../../store/toast'

type MetaRowProps = { label: string; value: string; mono?: boolean }

export const MetaRow: FC<MetaRowProps> = ({ label, value, mono }) => {
    const copy = (event: MouseEvent) => {
        event.preventDefault()
        navigator.clipboard
            .writeText(value)
            .then(() => useToast.getState().show('복사됨'))
            .catch(() => undefined)
    }
    return (
        <div
            onContextMenu={copy}
            title='우클릭하여 값 복사'
            className='flex items-baseline justify-between gap-3 px-3 py-1 text-xs hover:bg-neutral-800/40'>
            <span className='shrink-0 text-neutral-500'>{label}</span>
            <span className={`min-w-0 truncate text-right text-neutral-200 ${mono ? 'font-mono' : ''}`} title={value}>
                {value}
            </span>
        </div>
    )
}
