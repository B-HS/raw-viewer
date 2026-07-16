import { confirm } from '@tauri-apps/plugin-dialog'
import { i18n } from '../i18n/i18n'
import { moveToTrash } from '../ipc/fs'
import { useOrganize } from '../store/organize'
import { usePairs } from '../store/pairs'
import { usePlaylist } from '../store/playlist'
import { useToast } from '../store/toast'

export const confirmAndTrash = async (imageIds: string[]) => {
    if (imageIds.length === 0) return
    const pairs = usePairs.getState()
    const total = imageIds.reduce((sum, id) => sum + (pairs.isPaired(id) ? 2 : 1), 0)
    const confirmed = await confirm(i18n.t('trash.confirm', { count: total }), { title: i18n.t('trash.title'), kind: 'warning' }).catch(() => false)
    if (!confirmed) return
    const removed = await moveToTrash(imageIds).catch(() => [] as string[])
    if (removed.length > 0) {
        usePlaylist.getState().removeEntries(removed)
        useOrganize.getState().forget(removed)
        useToast.getState().show(i18n.t('toast.trashedCount', { count: removed.length }))
    }
}
