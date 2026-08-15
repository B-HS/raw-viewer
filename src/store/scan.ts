import { i18n } from '../i18n/i18n'
import { useEditStore } from './editStore'
import { useUiStore } from './uiStore'
import type { ScanState } from '../types/ScanState'

const SCAN_DEFAULT_INSET = 0.1

const CORNER_ADJACENT_EDGES: [number, number][] = [
    [0, 3],
    [0, 1],
    [1, 2],
    [2, 3],
]

const midpoint = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

export const defaultScanState = (): ScanState => {
    const lo = SCAN_DEFAULT_INSET
    const hi = 1 - SCAN_DEFAULT_INSET
    const corners: ScanState['corners'] = [
        [lo, lo],
        [hi, lo],
        [hi, hi],
        [lo, hi],
    ]
    const [tl, tr, br, bl] = corners
    return { enabled: true, corners, edges: [midpoint(tl, tr), midpoint(tr, br), midpoint(bl, br), midpoint(tl, bl)] }
}

export const toggleScanEditMode = () => {
    const ui = useUiStore.getState()
    const editStore = useEditStore.getState()
    if (!editStore.state) return
    if (ui.scanEditMode) {
        ui.setScanEditMode(false)
        return
    }
    const scan = editStore.state.scan
    if (!scan) editStore.edit((draft) => void (draft.scan = defaultScanState()), { label: i18n.t('history.scan') })
    else if (!scan.enabled) editStore.edit((draft) => void (draft.scan && (draft.scan.enabled = true)), { label: i18n.t('history.scanToggle') })
    ui.setScanEditMode(true)
}

export const setScanEnabled = (on: boolean) => {
    const editStore = useEditStore.getState()
    if (!editStore.state?.scan) return
    editStore.edit((draft) => void (draft.scan && (draft.scan.enabled = on)), { label: i18n.t('history.scanToggle') })
    if (!on) useUiStore.getState().setScanEditMode(false)
}

export const resetScan = () => {
    const editStore = useEditStore.getState()
    if (!editStore.state?.scan) return
    useUiStore.getState().setScanEditMode(false)
    editStore.edit((draft) => void (draft.scan = null), { label: i18n.t('history.scanReset') })
}

export const setScanCorner = (index: number, u: number, v: number) =>
    useEditStore.getState().edit(
        (draft) => {
            const scan = draft.scan
            if (!scan) return
            const previous = scan.corners[index]
            const next: [number, number] = [clamp01(u), clamp01(v)]
            const halfDeltaX = (next[0] - previous[0]) / 2
            const halfDeltaY = (next[1] - previous[1]) / 2
            scan.corners[index] = next
            for (const edgeIndex of CORNER_ADJACENT_EDGES[index]) {
                const edge = scan.edges[edgeIndex]
                scan.edges[edgeIndex] = [clamp01(edge[0] + halfDeltaX), clamp01(edge[1] + halfDeltaY)]
            }
        },
        { coalesceKey: 'scan.handle', label: i18n.t('history.scanAdjust') },
    )

export const setScanEdge = (index: number, u: number, v: number) =>
    useEditStore.getState().edit(
        (draft) => {
            if (!draft.scan) return
            draft.scan.edges[index] = [clamp01(u), clamp01(v)]
        },
        { coalesceKey: 'scan.handle', label: i18n.t('history.scanAdjust') },
    )
