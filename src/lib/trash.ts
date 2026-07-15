import { confirm } from '@tauri-apps/plugin-dialog'
import { moveToTrash } from '../ipc/fs'
import { useOrganize } from '../store/organize'
import { usePlaylist } from '../store/playlist'
import { useToast } from '../store/toast'

export const confirmAndTrash = async (imageIds: string[]) => {
    if (imageIds.length === 0) return
    const label = imageIds.length === 1 ? '1개 파일을' : `${imageIds.length}개 파일을`
    const confirmed = await confirm(`${label} 휴지통으로 이동합니다.`, { title: '휴지통으로 이동', kind: 'warning' }).catch(() => false)
    if (!confirmed) return
    const removed = await moveToTrash(imageIds).catch(() => [] as string[])
    if (removed.length > 0) {
        usePlaylist.getState().removeEntries(removed)
        useOrganize.getState().forget(removed)
        useToast.getState().show(`${removed.length}개 휴지통으로 이동`)
    }
}
