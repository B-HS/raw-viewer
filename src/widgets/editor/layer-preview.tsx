import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import { rasterizeDrawer } from '../../gl/drawerRaster'
import type { DrawerLayer } from '../../types/DrawerLayer'
import { EDITOR_PREVIEW_HEIGHT, EDITOR_PREVIEW_WIDTH } from '../../shared/constants/editor'

type LayerPreviewProps = { layer: DrawerLayer }

export const LayerPreview: FC<LayerPreviewProps> = ({ layer }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const ctx = canvasRef.current?.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, EDITOR_PREVIEW_WIDTH, EDITOR_PREVIEW_HEIGHT)
        const preview = rasterizeDrawer({ layers: [{ ...layer, visible: true, opacity: 100 }] }, EDITOR_PREVIEW_WIDTH, EDITOR_PREVIEW_HEIGHT)
        if (preview) ctx.drawImage(preview, 0, 0)
    }, [layer])

    return (
        <canvas
            ref={canvasRef}
            width={EDITOR_PREVIEW_WIDTH}
            height={EDITOR_PREVIEW_HEIGHT}
            aria-hidden='true'
            className='h-7 w-10 shrink-0 rounded border border-neutral-600 bg-neutral-800'
        />
    )
}
