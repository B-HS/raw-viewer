import type { FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '../../../store/toast'

type MetaRowProps = { label: string; value: string; mono?: boolean }

export const MetaRow: FC<MetaRowProps> = ({ label, value, mono }) => {
    const { t } = useTranslation()
    const copy = (event: MouseEvent) => {
        event.preventDefault()
        navigator.clipboard
            .writeText(value)
            .then(() => useToast.getState().show(t('toast.valueCopied')))
            .catch(() => undefined)
    }
    return (
        <div
            onContextMenu={copy}
            title={t('meta.rowCopyHint')}
            className='flex items-baseline justify-between gap-3 px-3 py-1 text-xs hover:bg-neutral-800/40'>
            <span className='shrink-0 text-neutral-500'>{label}</span>
            <span className={`min-w-0 truncate text-right text-neutral-200 ${mono ? 'font-mono' : ''}`} title={value}>
                {value}
            </span>
        </div>
    )
}
