import { openUrl } from '@tauri-apps/plugin-opener'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const GITHUB_PROFILE_URL = 'https://github.com/B-HS'
const REPOSITORY_URL = 'https://github.com/B-HS/raw-viewer'

export const AboutSummary: FC<{ version: string }> = ({ version }) => {
    const { t } = useTranslation()
    return (
        <div className='flex flex-col gap-2 px-5 py-4'>
            <div className='flex items-baseline gap-2'>
                <span className='text-base font-semibold text-neutral-100'>Raw Viewer</span>
                {version && <span className='font-mono text-[11px] text-neutral-500'>{`${t('about.version')} ${version}`}</span>}
            </div>
            <p className='text-xs leading-relaxed text-neutral-400'>{t('about.tagline')}</p>
            <div className='flex flex-col gap-1 text-xs text-neutral-400'>
                <div className='flex items-center gap-2'>
                    <span className='text-neutral-500'>{t('about.author')}</span>
                    <span className='text-neutral-200'>Hyunseok Byun</span>
                    <button
                        type='button'
                        onClick={() => openUrl(GITHUB_PROFILE_URL).catch(() => undefined)}
                        className='rounded px-1 text-sky-400 hover:bg-neutral-800 hover:text-sky-300'>
                        @B-HS
                    </button>
                </div>
                <div className='flex items-center gap-2'>
                    <span className='text-neutral-500'>{t('about.repository')}</span>
                    <button
                        type='button'
                        onClick={() => openUrl(REPOSITORY_URL).catch(() => undefined)}
                        className='rounded px-1 text-sky-400 hover:bg-neutral-800 hover:text-sky-300'>
                        github.com/B-HS/raw-viewer
                    </button>
                </div>
            </div>
        </div>
    )
}
