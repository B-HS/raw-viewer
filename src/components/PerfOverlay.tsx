import type { FC } from 'react'

type PerfOverlayProps = {
    visible: boolean
}

export const PerfOverlay: FC<PerfOverlayProps> = ({ visible }) => {
    if (!visible) return null
    return (
        <div className='fixed bottom-2 right-2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-neutral-300' aria-label='성능 오버레이'>
            perf: 계측 대기
        </div>
    )
}
