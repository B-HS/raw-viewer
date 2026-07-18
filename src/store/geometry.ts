import { i18n } from '../i18n/i18n'
import { useEditStore } from './editStore'

const QUARTER_TURNS = 4

export const rotateBy = (delta: number) =>
    useEditStore
        .getState()
        .edit((draft) => void (draft.geometry.rotate90 = (((draft.geometry.rotate90 + delta) % QUARTER_TURNS) + QUARTER_TURNS) % QUARTER_TURNS), {
            label: i18n.t('history.rotate'),
        })

export const toggleFlipH = () =>
    useEditStore.getState().edit((draft) => void (draft.geometry.flipH = !draft.geometry.flipH), { label: i18n.t('history.flipH') })

export const toggleFlipV = () =>
    useEditStore.getState().edit((draft) => void (draft.geometry.flipV = !draft.geometry.flipV), { label: i18n.t('history.flipV') })
