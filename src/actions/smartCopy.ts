import { renderClipboardPng } from '../gl/clipboardRender'
import { i18n } from '../i18n/i18n'
import { getEditState } from '../ipc/commands'
import { copyImageToClipboard } from '../ipc/platform'
import { useEditStore } from '../store/editStore'
import { ensureAethSource } from '../store/exportStore'
import { useLens } from '../store/lens'
import { usePlaylist } from '../store/playlist'
import { useToast } from '../store/toast'

let copying = false

export const smartCopyCurrent = async () => {
    if (copying) return
    const state = usePlaylist.getState()
    const current = state.entries[state.currentIndex]
    if (!current) return
    copying = true
    useToast.getState().show(i18n.t('toast.copying'))
    try {
        await useEditStore.getState().flushPending()
        const envelope = await getEditState(current.imageId)
        const resolved = await ensureAethSource(current.imageId)
        if (!resolved) {
            useToast.getState().show(i18n.t('toast.copyFailed'))
            return
        }
        const lensProfile = await useLens.getState().resolve(current.imageId)
        const blob = await renderClipboardPng(resolved.source, envelope.state, lensProfile)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        await copyImageToClipboard(bytes)
        useToast.getState().show(i18n.t('toast.copied'))
    } catch {
        useToast.getState().show(i18n.t('toast.copyFailed'))
    } finally {
        copying = false
    }
}
