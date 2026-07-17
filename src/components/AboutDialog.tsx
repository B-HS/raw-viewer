import { getVersion } from '@tauri-apps/api/app'
import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { getLicenses } from '../ipc/about'
import { useModalDismiss } from '../lib/useModalDismiss'
import { useOverlays } from '../store/overlays'

export const AboutDialog: FC = () => {
    const dialogRef = useRef<HTMLDivElement>(null)
    const { t } = useTranslation()
    const open = useOverlays((state) => state.aboutOpen)
    const [version, setVersion] = useState('')
    const [html, setHtml] = useState('')

    const close = () => useOverlays.getState().closeAbout()

    useEffect(() => {
        if (!open) return
        getVersion()
            .then(setVersion)
            .catch(() => setVersion(''))
        getLicenses()
            .then(setHtml)
            .catch(() => setHtml(''))
    }, [open])

    useModalDismiss(dialogRef, close)

    if (!open) return null

    return (
        <div className='fixed inset-0 z-[70] flex items-center justify-center bg-black/60' onClick={close}>
            <div
                ref={dialogRef}
                role='dialog'
                aria-modal='true'
                aria-label={t('about.title')}
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
                className='flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-200 shadow-2xl outline-none'>
                <div className='flex items-center justify-between border-b border-neutral-800 px-5 py-3'>
                    <h2 className='text-sm font-semibold'>
                        {t('about.title')}
                        {version && <span className='ml-2 font-mono text-[11px] text-neutral-500'>{`${t('about.version')} ${version}`}</span>}
                    </h2>
                    <button
                        type='button'
                        onClick={close}
                        title={t('about.close')}
                        aria-label={t('about.close')}
                        className='rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200'>
                        ✕
                    </button>
                </div>
                <div className='min-h-0 flex-1 bg-white'>
                    {html ? (
                        <iframe srcDoc={html} title={t('about.title')} sandbox='' className='h-full w-full border-0' />
                    ) : (
                        <div className='flex h-full items-center justify-center text-xs text-neutral-500'>{t('about.loading')}</div>
                    )}
                </div>
            </div>
        </div>
    )
}
