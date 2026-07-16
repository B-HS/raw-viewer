import { useEffect } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { REC2020_LUMA } from '../../gl/colorSpaces'
import { useEditStore } from '../../store/editStore'
import { useHistogram } from '../../store/histogramStore'
import { useLens } from '../../store/lens'
import { usePlaylist } from '../../store/playlist'
import { useUiStore } from '../../store/uiStore'
import { CpuFallbackView } from './CpuFallbackView'
import { CropOverlay } from './CropOverlay'
import { HistogramHoverOverlay } from './HistogramHoverOverlay'
import { SamplerPinsOverlay } from './SamplerPinsOverlay'
import { TatOverlay } from './TatOverlay'
import { useRenderEngine } from './useRenderEngine'

export const Viewport: FC = () => {
    const { t } = useTranslation()
    const { canvasRef, caps, gpuError, engine } = useRenderEngine()
    const currentIndex = usePlaylist((state) => state.currentIndex)
    const entries = usePlaylist((state) => state.entries)
    const best = usePlaylist((state) => state.best)
    const errors = usePlaylist((state) => state.errors)
    const cropEditMode = useUiStore((state) => state.cropEditMode)
    const compare = useUiStore((state) => state.compare)
    const sideBySide = useUiStore((state) => state.sideBySide)
    const eyedropper = useUiStore((state) => state.eyedropper)
    const tatActive = useUiStore((state) => state.tatActive)

    const current = entries[currentIndex]
    const level = current ? best[current.imageId] : undefined
    const error = current ? errors[current.imageId] : undefined
    const noProfile = level?.hasColorProfile === false

    const sampleWhiteBalance = (event: React.MouseEvent) => {
        if (!engine || !useEditStore.getState().isRaw) {
            useUiStore.getState().setEyedropper(false)
            return
        }
        const rect = event.currentTarget.getBoundingClientRect()
        const pixel = engine.samplePixel(event.clientX - rect.left, event.clientY - rect.top)
        useUiStore.getState().setEyedropper(false)
        if (!pixel) return
        const luma = REC2020_LUMA[0] * pixel.r + REC2020_LUMA[1] * pixel.g + REC2020_LUMA[2] * pixel.b
        if (luma <= 0 || pixel.r <= 0 || pixel.g <= 0 || pixel.b <= 0) return
        const { temp, tint } = engine.tempTintFromGains([luma / pixel.r, luma / pixel.g, luma / pixel.b])
        useEditStore.getState().edit(
            (draft) => {
                draft.wb.temp = temp
                draft.wb.tint = tint
            },
            { label: t('history.whiteBalanceEyedropper') },
        )
    }

    const onDividerMove = (event: React.PointerEvent) => {
        if (event.buttons === 0 || !compare) return
        const rect = event.currentTarget.getBoundingClientRect()
        const position = compare.axis === 'x' ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height
        useUiStore.getState().setComparePosition(position)
    }

    useEffect(() => {
        useUiStore.getState().attachEngine(engine)
        if (engine) {
            const state = useEditStore.getState().state
            if (state) engine.setEditState(state)
            useLens.getState().syncEngine()
        }
        return () => {
            useUiStore.getState().attachEngine(null)
        }
    }, [engine])

    useEffect(() => {
        if (!engine) return
        const unsubscribe = engine.onHistogram((hist) => useHistogram.getState().setData(hist))
        return () => {
            unsubscribe()
            useHistogram.getState().setData(null)
        }
    }, [engine])

    if (gpuError)
        return (
            <div className='relative h-full w-full overflow-hidden bg-viewport'>
                <CpuFallbackView />
            </div>
        )

    return (
        <div className='relative h-full w-full overflow-hidden bg-viewport'>
            <canvas ref={canvasRef} className='absolute inset-0 block h-full w-full' />

            {compare && (
                <div
                    className='absolute inset-0 touch-none'
                    style={{ cursor: compare.axis === 'x' ? 'ew-resize' : 'ns-resize' }}
                    onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId)
                        onDividerMove(event)
                    }}
                    onPointerMove={onDividerMove}
                    onDoubleClick={() => useUiStore.getState().resetComparePosition()}>
                    <div
                        className='absolute bg-white/70'
                        style={
                            compare.axis === 'x'
                                ? { left: `${compare.position * 100}%`, top: 0, width: 2, height: '100%', transform: 'translateX(-1px)' }
                                : { top: `${compare.position * 100}%`, left: 0, height: 2, width: '100%', transform: 'translateY(-1px)' }
                        }
                    />
                </div>
            )}

            {sideBySide && (
                <div className='pointer-events-none absolute inset-0'>
                    <div className='absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/60' />
                    <span className='absolute left-1/4 top-3 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium text-neutral-100'>
                        {t('viewport.compareBefore')}
                    </span>
                    <span className='absolute left-3/4 top-3 -translate-x-1/2 rounded bg-black/60 px-2 py-0.5 text-[11px] font-medium text-neutral-100'>
                        {t('viewport.compareAfter')}
                    </span>
                </div>
            )}

            {eyedropper && <div className='absolute inset-0' style={{ cursor: 'crosshair' }} onClick={sampleWhiteBalance} />}

            <HistogramHoverOverlay />
            <SamplerPinsOverlay />
            {tatActive && engine && !sideBySide && <TatOverlay />}

            {cropEditMode && <CropOverlay />}

            <div className='pointer-events-none absolute left-3 top-3 flex flex-col gap-2'>
                {caps?.lowPrecision && (
                    <span className='rounded bg-amber-500/80 px-2 py-1 text-xs font-medium text-black'>{t('viewport.lowPrecision')}</span>
                )}
                {noProfile && <span className='rounded bg-amber-500/80 px-2 py-1 text-xs font-medium text-black'>{t('viewport.noProfile')}</span>}
            </div>

            {error && current && (
                <div className='absolute inset-0 flex items-center justify-center p-6'>
                    <div className='w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900/90 px-6 py-5 text-center text-neutral-200'>
                        <p className='text-2xl'>⚠</p>
                        <p className='mt-2 text-base font-medium'>{t('viewport.loadFailed')}</p>
                        <p className='mt-3 break-all text-sm text-neutral-300'>{current.fileName}</p>
                        <p className='mt-1 text-xs text-neutral-400'>{error}</p>
                        <div className='mt-4 flex justify-center'>
                            <button
                                type='button'
                                onClick={() => navigator.clipboard.writeText(`${current.fileName}\n${error}`)}
                                className='rounded border border-neutral-600 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800'>
                                {t('viewport.copyDetails')}
                            </button>
                        </div>
                        <p className='mt-4 text-xs text-neutral-500'>{t('viewport.navHint')}</p>
                    </div>
                </div>
            )}

            {!error && (
                <div className='pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 rounded bg-black/60 px-2.5 py-1 text-xs text-neutral-200'>
                    <span>{level ? t(`viewport.level.${level.level}`) : t('viewport.decoding')}</span>
                    {(!level || level.level !== 'l2') && (
                        <span className='h-3 w-3 animate-spin rounded-full border-2 border-neutral-500 border-t-neutral-200' />
                    )}
                </div>
            )}
        </div>
    )
}
