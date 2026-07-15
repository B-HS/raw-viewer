import { useState } from 'react'
import type { FC, PropsWithChildren } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditStore } from '../../store/editStore'
import { useUiStore } from '../../store/uiStore'
import type { EditSection } from '../../store/editDefaults'

type SectionProps = PropsWithChildren<{ id: EditSection; title: string; right?: React.ReactNode }>

export const Section: FC<SectionProps> = ({ id, title, right, children }) => {
    const { t } = useTranslation()
    const [open, setOpen] = useState(true)
    const active = useUiStore((state) => state.activeSection === id)

    return (
        <section
            onPointerDownCapture={() => useUiStore.getState().setActiveSection(id)}
            className={`border-b border-neutral-800 ${active ? 'bg-neutral-900/40' : ''}`}>
            <header className='flex items-center justify-between px-3 py-2'>
                <button
                    type='button'
                    onClick={() => setOpen((value) => !value)}
                    className='flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-300 hover:text-neutral-100'>
                    <span className={`text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                    {title}
                </button>
                <div className='flex items-center gap-2'>
                    {right}
                    <button
                        type='button'
                        onClick={() => useEditStore.getState().resetSection(id)}
                        aria-label={t('panel.sectionReset', { title })}
                        className='rounded px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200'>
                        {t('common.reset')}
                    </button>
                </div>
            </header>
            {open && <div className='flex flex-col gap-3 px-3 pb-3'>{children}</div>}
        </section>
    )
}
