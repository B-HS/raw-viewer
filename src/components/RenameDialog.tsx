import { useState } from 'react'
import type { FC, FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { renameImage } from '../ipc/commands'
import { useEditStore } from '../store/editStore'
import { usePlaylist } from '../store/playlist'
import { useRenameDialog } from '../store/renameDialog'
import { useToast } from '../store/toast'

export const RenameDialog: FC = () => {
    const target = useRenameDialog((state) => state.target)
    const [value, setValue] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const { t } = useTranslation()

    if (!target) return null

    const name = value ?? target.fileName
    const close = () => {
        setValue(null)
        setBusy(false)
        useRenameDialog.getState().close()
    }

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault()
        if (busy || name === target.fileName) {
            close()
            return
        }
        setBusy(true)
        try {
            const entry = await renameImage(target.imageId, name.trim())
            const playlist = usePlaylist.getState()
            const index = playlist.entries.findIndex((item) => item.imageId === target.imageId)
            if (index >= 0) playlist.replaceEntryAt(index, entry)
            playlist.invalidate([target.imageId])
            if (useEditStore.getState().imageId === target.imageId) useEditStore.getState().loadForImage(entry.imageId, entry.isRaw)
            useToast.getState().show(t('toast.renameDone'))
            close()
        } catch (error) {
            setBusy(false)
            const message = error instanceof Error ? error.message : String(error)
            useToast.getState().show(t('toast.renameFailed', { message }))
        }
    }

    return (
        <div className='absolute inset-0 z-[80] flex items-center justify-center bg-black/50' onClick={close}>
            <form
                onSubmit={handleSubmit}
                onClick={(event) => event.stopPropagation()}
                className='flex w-[min(24rem,calc(100%-2rem))] flex-col gap-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-xl'>
                <p className='text-sm font-medium text-neutral-200'>{t('rename.title')}</p>
                <input
                    autoFocus
                    value={name}
                    onChange={(event) => setValue(event.target.value)}
                    aria-label={t('rename.title')}
                    className='rounded border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-400'
                />
                <div className='flex justify-end gap-2 text-sm'>
                    <button
                        type='button'
                        onClick={close}
                        className='rounded border border-neutral-600 px-3 py-1.5 text-neutral-300 hover:bg-neutral-800'>
                        {t('common.cancel')}
                    </button>
                    <button type='submit' disabled={busy} className='rounded bg-neutral-200 px-3 py-1.5 font-medium text-neutral-900 hover:bg-white'>
                        {t('common.save')}
                    </button>
                </div>
            </form>
        </div>
    )
}
