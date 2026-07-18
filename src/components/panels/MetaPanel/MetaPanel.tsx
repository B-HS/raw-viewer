import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useState } from 'react'
import type { ComponentType, FC } from 'react'
import { useTranslation } from 'react-i18next'
import { getReverseGeocode } from '../../../ipc/geocode'
import { useEditStore } from '../../../store/editStore'
import { useMeta } from '../../../store/meta'
import { useOrganize } from '../../../store/organize'
import { useSettings } from '../../../store/settings'
import { useToast } from '../../../store/toast'
import type { GpsMeta } from '../../../types/GpsMeta'
import type { SensorType } from '../../../types/SensorType'
import {
    aspectRatio,
    formatAltitude,
    formatAperture,
    formatBytes,
    formatCoord,
    formatDms,
    formatEpoch,
    formatExposureBias,
    formatFocal,
    formatResolution,
    formatShutter,
} from './format'
import { MetaSection } from './MetaSection'

type Pair = [string, string | null | undefined, boolean?]

const rowsFrom = (pairs: Pair[]) =>
    pairs.filter((pair) => pair[1] != null && pair[1] !== '').map((pair) => ({ label: pair[0], value: String(pair[1]), mono: pair[2] }))

const sensorLabel = (sensor: SensorType, cfa: string | null) => {
    if (sensor === 'bayer') return cfa ? `Bayer ${cfa}` : 'Bayer'
    if (sensor === 'xtrans') return 'X-Trans'
    if (sensor === 'monochrome') return 'Monochrome'
    if (sensor === 'foveon') return 'Foveon'
    return null
}

export const MetaPanel: FC = () => {
    const { t } = useTranslation()
    const [MapComponent, setMapComponent] = useState<ComponentType<{ gps: GpsMeta }> | null>(null)

    const metadata = useMeta((state) => state.metadata)
    const loading = useMeta((state) => state.loading)
    const error = useMeta((state) => state.error)
    const metaImageId = useMeta((state) => state.imageId)
    const gpsCollapsed = useMeta((state) => state.collapsed['gps'] ?? false)
    const organize = useOrganize((state) => (metaImageId ? state.entries[metaImageId] : undefined))
    const edited = useOrganize((state) => (metaImageId ? (state.edited[metaImageId] ?? false) : false))
    const editMeta = useEditStore((state) => (state.imageId === metaImageId ? (state.state?.meta ?? null) : null))
    const showAddress = useSettings((state) => state.showAddress)
    const [addressFor, setAddressFor] = useState<{ imageId: string; name: string | null } | null>(null)

    const gps = metadata?.gps ?? null
    const hasGps = gps != null
    const address = addressFor && addressFor.imageId === metaImageId ? addressFor.name : null

    useEffect(() => {
        if (!hasGps || MapComponent) return
        let alive = true
        import('./GpsMap').then((module) => alive && setMapComponent(() => module.GpsMap)).catch(() => undefined)
        return () => {
            alive = false
        }
    }, [hasGps, MapComponent])

    useEffect(() => {
        if (!showAddress || !hasGps || gpsCollapsed || !metaImageId) return
        let alive = true
        getReverseGeocode(metaImageId)
            .then((name) => alive && setAddressFor({ imageId: metaImageId, name }))
            .catch(() => alive && setAddressFor({ imageId: metaImageId, name: null }))
        return () => {
            alive = false
        }
    }, [metaImageId, showAddress, gpsCollapsed, hasGps])

    return (
        <aside className='flex h-full w-80 flex-col border-l border-neutral-800 bg-neutral-900 text-neutral-200'>
            <div className='flex items-center justify-between border-b border-neutral-800 px-3 py-2'>
                <span className='text-xs font-semibold uppercase tracking-wide text-neutral-400'>{t('meta.title')}</span>
                {loading && <span className='h-3 w-3 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300' />}
            </div>
            {!metadata ? (
                <div className='flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-500'>
                    {error ?? (loading ? t('meta.loading') : t('common.selectImage'))}
                </div>
            ) : (
                <div className='min-h-0 flex-1 overflow-y-auto'>
                    {metadata.warnings.length > 0 && (
                        <div className='flex flex-wrap gap-1 border-b border-neutral-800 px-3 py-2'>
                            {metadata.warnings.map((warning) => (
                                <span key={warning} className='rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300'>
                                    ⚠ {t(`meta.warning.${warning}`, { defaultValue: warning })}
                                </span>
                            ))}
                        </div>
                    )}
                    <MetaSection
                        id='file'
                        title={t('meta.section.file')}
                        rows={rowsFrom([
                            [t('meta.file.name'), metadata.file.name],
                            [t('meta.file.path'), metadata.file.path, true],
                            [t('meta.file.size'), formatBytes(metadata.file.sizeBytes)],
                            [t('meta.file.format'), metadata.file.format],
                            [t('meta.file.resolution'), formatResolution(metadata.file.width, metadata.file.height, metadata.file.megapixels)],
                            [t('meta.file.aspectRatio'), aspectRatio(metadata.file.width, metadata.file.height)],
                            [t('meta.file.bitDepth'), metadata.file.bitDepth != null ? `${metadata.file.bitDepth}-bit` : null],
                            [t('meta.file.colorSpace'), metadata.file.colorSpace],
                            [t('meta.file.icc'), metadata.file.iccProfileName],
                            [t('meta.file.created'), formatEpoch(metadata.file.createdAt)],
                            [t('meta.file.modified'), formatEpoch(metadata.file.modifiedAt)],
                            [t('meta.file.sidecar'), metadata.file.hasSidecar ? t('meta.yes') : t('meta.no')],
                        ])}
                    />
                    <MetaSection
                        id='camera'
                        title={t('meta.section.camera')}
                        rows={rowsFrom([
                            [t('meta.camera.make'), metadata.camera.make],
                            [t('meta.camera.model'), metadata.camera.model],
                            [t('meta.camera.serial'), metadata.camera.serial],
                            [t('meta.camera.firmware'), metadata.camera.firmware],
                            [t('meta.camera.sensor'), sensorLabel(metadata.camera.sensorType, metadata.camera.cfaPattern)],
                            [t('meta.camera.cropFactor'), metadata.camera.cropFactor != null ? `${metadata.camera.cropFactor.toFixed(2)}×` : null],
                        ])}
                    />
                    <MetaSection
                        id='lens'
                        title={t('meta.section.lens')}
                        rows={rowsFrom([
                            [t('meta.lens.make'), metadata.lens.make],
                            [t('meta.lens.model'), metadata.lens.model],
                            [t('meta.lens.serial'), metadata.lens.serial],
                            [t('meta.lens.mount'), metadata.lens.mount],
                            [t('meta.lens.maxAperture'), metadata.lens.maxAperture != null ? formatAperture(metadata.lens.maxAperture) : null],
                            [t('meta.lens.focal35'), metadata.lens.focalLength35mm != null ? formatFocal(metadata.lens.focalLength35mm) : null],
                            [t('meta.lens.teleconverter'), metadata.lens.teleconverter],
                        ])}
                    />
                    <MetaSection
                        id='exposure'
                        title={t('meta.section.exposure')}
                        rows={rowsFrom([
                            [t('meta.exposure.shutter'), metadata.exposure.shutterSpeed ? formatShutter(metadata.exposure.shutterSpeed) : null],
                            [t('meta.exposure.aperture'), metadata.exposure.fNumber != null ? formatAperture(metadata.exposure.fNumber) : null],
                            [t('meta.exposure.iso'), metadata.exposure.iso != null ? `${metadata.exposure.iso}` : null],
                            [t('meta.exposure.focal'), metadata.exposure.focalLength != null ? formatFocal(metadata.exposure.focalLength) : null],
                            [
                                t('meta.exposure.bias'),
                                metadata.exposure.exposureBias != null ? formatExposureBias(metadata.exposure.exposureBias) : null,
                            ],
                            [t('meta.exposure.mode'), metadata.exposure.exposureMode],
                            [t('meta.exposure.metering'), metadata.exposure.meteringMode],
                            [
                                t('meta.exposure.flash'),
                                metadata.exposure.flash
                                    ? `${metadata.exposure.flash.fired ? t('meta.exposure.flashFired') : t('meta.exposure.flashNotFired')} · ${metadata.exposure.flash.mode}${metadata.exposure.flash.compensation != null ? ` (${metadata.exposure.flash.compensation > 0 ? '+' : ''}${metadata.exposure.flash.compensation} EV)` : ''}`
                                    : null,
                            ],
                            [
                                t('meta.exposure.whiteBalance'),
                                metadata.exposure.whiteBalance
                                    ? `${metadata.exposure.whiteBalance}${metadata.exposure.wbTemp != null ? ` (${metadata.exposure.wbTemp}K)` : ''}`
                                    : null,
                            ],
                            [
                                t('meta.exposure.dof'),
                                metadata.exposure.dof
                                    ? `${metadata.exposure.dof.near.toFixed(2)}–${metadata.exposure.dof.far.toFixed(2)} m (${t('meta.exposure.hyperfocal', { value: metadata.exposure.dof.hyperfocal.toFixed(2) })})`
                                    : null,
                            ],
                            [
                                t('meta.exposure.subjectDistance'),
                                metadata.exposure.subjectDistance != null ? `${metadata.exposure.subjectDistance.toFixed(2)} m` : null,
                            ],
                            [t('meta.exposure.driveMode'), metadata.exposure.driveMode],
                            [t('meta.exposure.stabilization'), metadata.exposure.stabilization],
                        ])}
                    />
                    <MetaSection
                        id='dates'
                        title={t('meta.section.dates')}
                        rows={rowsFrom([
                            [t('meta.dates.original'), metadata.dates.original],
                            [t('meta.dates.digitized'), metadata.dates.digitized],
                            [t('meta.dates.modified'), metadata.dates.modified],
                            [t('meta.dates.timezone'), metadata.dates.timezoneOffset],
                            [t('meta.dates.subSec'), metadata.dates.subSec],
                        ])}
                    />
                    {metadata.raw && (
                        <MetaSection
                            id='raw'
                            title={t('meta.section.raw')}
                            rows={rowsFrom([
                                [t('meta.raw.cfa'), metadata.camera.cfaPattern],
                                [t('meta.raw.blackLevel'), metadata.raw.blackLevel.length ? metadata.raw.blackLevel.join(', ') : null, true],
                                [t('meta.raw.whiteLevel'), metadata.raw.whiteLevel.length ? metadata.raw.whiteLevel.join(', ') : null, true],
                                [
                                    t('meta.raw.asShotNeutral'),
                                    metadata.raw.asShotNeutral ? metadata.raw.asShotNeutral.map((value) => value.toFixed(3)).join(', ') : null,
                                    true,
                                ],
                                [t('meta.raw.colorMatrix'), metadata.raw.hasColorMatrix ? t('meta.yes') : t('meta.no')],
                                [t('meta.raw.compression'), metadata.raw.compression],
                                [
                                    t('meta.raw.dng'),
                                    metadata.raw.isDng
                                        ? metadata.raw.dngVersion
                                            ? t('meta.raw.dngVersion', { version: metadata.raw.dngVersion })
                                            : t('meta.raw.dngYes')
                                        : t('meta.raw.dngNo'),
                                ],
                                [
                                    t('meta.raw.embeddedPreview'),
                                    metadata.raw.embeddedPreviews.length
                                        ? t('meta.raw.previewCount', {
                                              count: metadata.raw.embeddedPreviews.length,
                                              dims: metadata.raw.embeddedPreviews.map((preview) => `${preview.width}×${preview.height}`).join(', '),
                                          })
                                        : t('meta.no'),
                                ],
                                [t('meta.raw.opcodeList'), metadata.raw.hasOpcodeList ? t('meta.yes') : t('meta.no')],
                            ])}
                        />
                    )}
                    {gps && (
                        <MetaSection
                            id='gps'
                            title={t('meta.section.gps')}
                            rows={rowsFrom([
                                [t('meta.gps.coord'), formatCoord(gps.lat, gps.lng), true],
                                [t('meta.gps.dms'), formatDms(gps.lat, gps.lng)],
                                [t('meta.gps.altitude'), gps.alt != null ? formatAltitude(gps.alt, gps.altRef) : null],
                                [
                                    t('meta.gps.direction'),
                                    gps.direction != null ? `${gps.direction.toFixed(1)}°${gps.directionRef ? ` ${gps.directionRef}` : ''}` : null,
                                ],
                                [t('meta.gps.speed'), gps.speed != null ? `${gps.speed.toFixed(1)}` : null],
                                [t('meta.gps.timestamp'), gps.timestamp],
                                [t('meta.gps.method'), gps.processingMethod],
                                [t('meta.gps.dop'), gps.dop != null ? gps.dop.toFixed(1) : null],
                            ])}>
                            {showAddress && address && (
                                <div className='px-3 pb-1'>
                                    <div className='text-xs leading-snug text-neutral-200'>{address}</div>
                                    <div className='mt-0.5 text-[9px] text-neutral-500'>{t('meta.gps.osmAttribution')}</div>
                                </div>
                            )}
                            {MapComponent && <MapComponent gps={gps} />}
                            <div className='flex flex-wrap gap-1 px-3 pb-1'>
                                <button
                                    type='button'
                                    onClick={() =>
                                        navigator.clipboard
                                            .writeText(formatCoord(gps.lat, gps.lng))
                                            .then(() => useToast.getState().show(t('toast.coordCopied')))
                                            .catch(() => undefined)
                                    }
                                    className='rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800'>
                                    {t('meta.gps.copyCoord')}
                                </button>
                                <button
                                    type='button'
                                    onClick={() =>
                                        openUrl(`https://www.google.com/maps/search/?api=1&query=${gps.lat},${gps.lng}`).catch(() => undefined)
                                    }
                                    className='rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800'>
                                    {t('meta.gps.googleMaps')}
                                </button>
                                <button
                                    type='button'
                                    onClick={() => openUrl(`https://maps.apple.com/?ll=${gps.lat},${gps.lng}`).catch(() => undefined)}
                                    className='rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800'>
                                    {t('meta.gps.appleMaps')}
                                </button>
                            </div>
                        </MetaSection>
                    )}
                    <MetaSection
                        id='aetherlens'
                        title={t('meta.section.aetherlens')}
                        rows={rowsFrom([
                            [t('meta.aether.edited'), edited ? t('common.edited') : t('common.original')],
                            [t('meta.aether.appliedPreset'), editMeta?.appliedPreset ?? null],
                            [t('meta.aether.rating'), organize && organize.rating > 0 ? '★'.repeat(organize.rating) : t('common.none')],
                            [t('meta.aether.label'), organize?.label ?? t('common.none')],
                            [
                                t('meta.aether.flag'),
                                organize?.flag === 'pick'
                                    ? t('meta.aether.flagPick')
                                    : organize?.flag === 'reject'
                                      ? t('meta.aether.flagReject')
                                      : t('common.none'),
                            ],
                            [t('meta.aether.lastEdit'), editMeta && editMeta.modifiedAt > 0 ? formatEpoch(editMeta.modifiedAt) : null],
                        ])}
                    />
                </div>
            )}
        </aside>
    )
}
