import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

type PerfOverlayProps = {
    visible: boolean
}

export const PerfOverlay: FC<PerfOverlayProps> = ({ visible }) => {
    const { t } = useTranslation()
    if (!visible) return null
    return (
        <div className='fixed bottom-2 right-2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-neutral-300' aria-label={t('perf.overlayAria')}>
            {t('perf.waiting')}
        </div>
    )
}
