import { openUrl } from '@tauri-apps/plugin-opener'
import { useEffect, useState } from 'react'
import type { ComponentType, FC } from 'react'
import { useEditStore } from '../../../store/editStore'
import { useMeta } from '../../../store/meta'
import { useOrganize } from '../../../store/organize'
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
import type { MetaRowData } from './MetaSection'

type Pair = [string, string | null | undefined, boolean?]

const rowsFrom = (pairs: Pair[]): MetaRowData[] =>
    pairs.filter((pair) => pair[1] != null && pair[1] !== '').map((pair) => ({ label: pair[0], value: String(pair[1]), mono: pair[2] }))

const sensorLabel = (sensor: SensorType, cfa: string | null) => {
    if (sensor === 'bayer') return cfa ? `Bayer ${cfa}` : 'Bayer'
    if (sensor === 'xtrans') return 'X-Trans'
    if (sensor === 'monochrome') return 'Monochrome'
    if (sensor === 'foveon') return 'Foveon'
    return null
}

const WARNING_LABEL: Record<string, string> = {
    'no-color-profile': '색 프로파일 없음',
    'unsupported-sensor': '미지원 센서',
    'corrupt-exif': 'EXIF 손상',
}

export const MetaPanel: FC = () => {
    const [MapComponent, setMapComponent] = useState<ComponentType<{ gps: GpsMeta }> | null>(null)

    const metadata = useMeta((state) => state.metadata)
    const loading = useMeta((state) => state.loading)
    const error = useMeta((state) => state.error)
    const metaImageId = useMeta((state) => state.imageId)
    const organize = useOrganize((state) => (metaImageId ? state.entries[metaImageId] : undefined))
    const edited = useOrganize((state) => (metaImageId ? (state.edited[metaImageId] ?? false) : false))
    const editMeta = useEditStore((state) => (state.imageId === metaImageId ? (state.state?.meta ?? null) : null))

    const gps = metadata?.gps ?? null

    useEffect(() => {
        if (!gps) {
            setMapComponent(null)
            return
        }
        let alive = true
        import('./GpsMap').then((module) => alive && setMapComponent(() => module.GpsMap)).catch(() => alive && setMapComponent(null))
        return () => {
            alive = false
        }
    }, [gps != null])

    return (
        <aside className='flex h-full w-80 flex-col border-l border-neutral-800 bg-neutral-900 text-neutral-200'>
            <div className='flex items-center justify-between border-b border-neutral-800 px-3 py-2'>
                <span className='text-xs font-semibold uppercase tracking-wide text-neutral-400'>메타데이터</span>
                {loading && <span className='h-3 w-3 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300' />}
            </div>
            {!metadata ? (
                <div className='flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-500'>
                    {error ?? (loading ? '메타데이터 로딩 중...' : '이미지를 선택하세요')}
                </div>
            ) : (
                <div className='min-h-0 flex-1 overflow-y-auto'>
                    {metadata.warnings.length > 0 && (
                        <div className='flex flex-wrap gap-1 border-b border-neutral-800 px-3 py-2'>
                            {metadata.warnings.map((warning) => (
                                <span key={warning} className='rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300'>
                                    ⚠ {WARNING_LABEL[warning] ?? warning}
                                </span>
                            ))}
                        </div>
                    )}
                    <MetaSection
                        id='file'
                        title='파일'
                        rows={rowsFrom([
                            ['파일명', metadata.file.name],
                            ['경로', metadata.file.path, true],
                            ['크기', formatBytes(metadata.file.sizeBytes)],
                            ['포맷', metadata.file.format],
                            ['해상도', formatResolution(metadata.file.width, metadata.file.height, metadata.file.megapixels)],
                            ['종횡비', aspectRatio(metadata.file.width, metadata.file.height)],
                            ['비트 심도', metadata.file.bitDepth != null ? `${metadata.file.bitDepth}-bit` : null],
                            ['색 공간', metadata.file.colorSpace],
                            ['ICC 프로파일', metadata.file.iccProfileName],
                            ['생성일', formatEpoch(metadata.file.createdAt)],
                            ['수정일', formatEpoch(metadata.file.modifiedAt)],
                            ['XMP 사이드카', metadata.file.hasSidecar ? '있음' : '없음'],
                        ])}
                    />
                    <MetaSection
                        id='camera'
                        title='카메라'
                        rows={rowsFrom([
                            ['제조사', metadata.camera.make],
                            ['모델', metadata.camera.model],
                            ['시리얼', metadata.camera.serial],
                            ['펌웨어', metadata.camera.firmware],
                            ['센서', sensorLabel(metadata.camera.sensorType, metadata.camera.cfaPattern)],
                            ['크롭 팩터', metadata.camera.cropFactor != null ? `${metadata.camera.cropFactor.toFixed(2)}×` : null],
                        ])}
                    />
                    <MetaSection
                        id='lens'
                        title='렌즈'
                        rows={rowsFrom([
                            ['제조사', metadata.lens.make],
                            ['모델', metadata.lens.model],
                            ['시리얼', metadata.lens.serial],
                            ['마운트', metadata.lens.mount],
                            ['최대 조리개', metadata.lens.maxAperture != null ? formatAperture(metadata.lens.maxAperture) : null],
                            ['35mm 환산', metadata.lens.focalLength35mm != null ? formatFocal(metadata.lens.focalLength35mm) : null],
                            ['텔레컨버터', metadata.lens.teleconverter],
                        ])}
                    />
                    <MetaSection
                        id='exposure'
                        title='노출'
                        rows={rowsFrom([
                            ['셔터 속도', metadata.exposure.shutterSpeed ? formatShutter(metadata.exposure.shutterSpeed) : null],
                            ['조리개', metadata.exposure.fNumber != null ? formatAperture(metadata.exposure.fNumber) : null],
                            ['ISO', metadata.exposure.iso != null ? `${metadata.exposure.iso}` : null],
                            ['초점거리', metadata.exposure.focalLength != null ? formatFocal(metadata.exposure.focalLength) : null],
                            ['노출 보정', metadata.exposure.exposureBias != null ? formatExposureBias(metadata.exposure.exposureBias) : null],
                            ['노출 모드', metadata.exposure.exposureMode],
                            ['측광 모드', metadata.exposure.meteringMode],
                            [
                                '플래시',
                                metadata.exposure.flash
                                    ? `${metadata.exposure.flash.fired ? '발광' : '미발광'} · ${metadata.exposure.flash.mode}${metadata.exposure.flash.compensation != null ? ` (${metadata.exposure.flash.compensation > 0 ? '+' : ''}${metadata.exposure.flash.compensation} EV)` : ''}`
                                    : null,
                            ],
                            [
                                '화이트 밸런스',
                                metadata.exposure.whiteBalance
                                    ? `${metadata.exposure.whiteBalance}${metadata.exposure.wbTemp != null ? ` (${metadata.exposure.wbTemp}K)` : ''}`
                                    : null,
                            ],
                            [
                                '피사계 심도',
                                metadata.exposure.dof
                                    ? `${metadata.exposure.dof.near.toFixed(2)}–${metadata.exposure.dof.far.toFixed(2)} m (과초점 ${metadata.exposure.dof.hyperfocal.toFixed(2)} m)`
                                    : null,
                            ],
                            ['피사체 거리', metadata.exposure.subjectDistance != null ? `${metadata.exposure.subjectDistance.toFixed(2)} m` : null],
                            ['드라이브 모드', metadata.exposure.driveMode],
                            ['손떨림 보정', metadata.exposure.stabilization],
                        ])}
                    />
                    <MetaSection
                        id='dates'
                        title='날짜'
                        rows={rowsFrom([
                            ['촬영 일시', metadata.dates.original],
                            ['디지털화', metadata.dates.digitized],
                            ['수정 일시', metadata.dates.modified],
                            ['시간대', metadata.dates.timezoneOffset],
                            ['서브초', metadata.dates.subSec],
                        ])}
                    />
                    {metadata.raw && (
                        <MetaSection
                            id='raw'
                            title='RAW'
                            rows={rowsFrom([
                                ['CFA 패턴', metadata.camera.cfaPattern],
                                ['Black Level', metadata.raw.blackLevel.length ? metadata.raw.blackLevel.join(', ') : null, true],
                                ['White Level', metadata.raw.whiteLevel.length ? metadata.raw.whiteLevel.join(', ') : null, true],
                                [
                                    'As Shot Neutral',
                                    metadata.raw.asShotNeutral ? metadata.raw.asShotNeutral.map((value) => value.toFixed(3)).join(', ') : null,
                                    true,
                                ],
                                ['컬러 매트릭스', metadata.raw.hasColorMatrix ? '있음' : '없음'],
                                ['압축', metadata.raw.compression],
                                ['DNG', metadata.raw.isDng ? (metadata.raw.dngVersion ? `예 (v${metadata.raw.dngVersion})` : '예') : '아니오'],
                                [
                                    '임베디드 프리뷰',
                                    metadata.raw.embeddedPreviews.length
                                        ? `${metadata.raw.embeddedPreviews.length}개 (${metadata.raw.embeddedPreviews.map((preview) => `${preview.width}×${preview.height}`).join(', ')})`
                                        : '없음',
                                ],
                                ['Opcode List', metadata.raw.hasOpcodeList ? '있음' : '없음'],
                            ])}
                        />
                    )}
                    {gps && (
                        <MetaSection
                            id='gps'
                            title='GPS'
                            rows={rowsFrom([
                                ['좌표', formatCoord(gps.lat, gps.lng), true],
                                ['DMS', formatDms(gps.lat, gps.lng)],
                                ['고도', gps.alt != null ? formatAltitude(gps.alt, gps.altRef) : null],
                                [
                                    '방위',
                                    gps.direction != null ? `${gps.direction.toFixed(1)}°${gps.directionRef ? ` ${gps.directionRef}` : ''}` : null,
                                ],
                                ['속도', gps.speed != null ? `${gps.speed.toFixed(1)}` : null],
                                ['타임스탬프', gps.timestamp],
                                ['측위 방식', gps.processingMethod],
                                ['DOP', gps.dop != null ? gps.dop.toFixed(1) : null],
                            ])}>
                            {MapComponent && <MapComponent gps={gps} />}
                            <div className='flex flex-wrap gap-1 px-3 pb-1'>
                                <button
                                    type='button'
                                    onClick={() =>
                                        navigator.clipboard
                                            .writeText(formatCoord(gps.lat, gps.lng))
                                            .then(() => useToast.getState().show('좌표 복사됨'))
                                            .catch(() => undefined)
                                    }
                                    className='rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800'>
                                    좌표 복사
                                </button>
                                <button
                                    type='button'
                                    onClick={() =>
                                        openUrl(`https://www.google.com/maps/search/?api=1&query=${gps.lat},${gps.lng}`).catch(() => undefined)
                                    }
                                    className='rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800'>
                                    Google Maps
                                </button>
                                <button
                                    type='button'
                                    onClick={() => openUrl(`https://maps.apple.com/?ll=${gps.lat},${gps.lng}`).catch(() => undefined)}
                                    className='rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-800'>
                                    Apple 지도
                                </button>
                            </div>
                        </MetaSection>
                    )}
                    <MetaSection
                        id='aetherlens'
                        title='AetherLens'
                        rows={rowsFrom([
                            ['편집 여부', edited ? '편집됨' : '원본'],
                            ['적용 프리셋', editMeta?.appliedPreset ?? null],
                            ['별점', organize && organize.rating > 0 ? '★'.repeat(organize.rating) : '없음'],
                            ['라벨', organize?.label ?? '없음'],
                            ['플래그', organize?.flag === 'pick' ? '채택' : organize?.flag === 'reject' ? '제외' : '없음'],
                            ['마지막 편집', editMeta && editMeta.modifiedAt > 0 ? formatEpoch(editMeta.modifiedAt) : null],
                        ])}
                    />
                </div>
            )}
        </aside>
    )
}
