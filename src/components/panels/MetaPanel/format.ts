import type { ShutterSpeed } from '../../../types/ShutterSpeed'

export const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes / 1024
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
    }
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export const formatShutter = (shutter: ShutterSpeed) => {
    if (shutter.den === 0) return '—'
    const ratio = shutter.num / shutter.den
    if (ratio > 0 && ratio < 1) return `1/${Math.round(shutter.den / shutter.num)}s`
    return Number.isInteger(ratio) ? `${ratio}s` : `${ratio.toFixed(1)}s`
}

export const formatAperture = (fNumber: number) => `f/${Number.isInteger(fNumber) ? fNumber.toFixed(0) : fNumber.toFixed(1)}`

export const formatFocal = (mm: number) => `${Math.round(mm)}mm`

export const formatExposureBias = (ev: number) => `${ev > 0 ? '+' : ''}${ev.toFixed(1)} EV`

export const formatMegapixels = (megapixels: number | null, width: number | null, height: number | null) => {
    const value = megapixels ?? (width && height ? (width * height) / 1_000_000 : null)
    return value == null ? null : `${value.toFixed(1)} MP`
}

export const formatResolution = (width: number | null, height: number | null, megapixels: number | null) => {
    if (!width || !height) return null
    const mp = formatMegapixels(megapixels, width, height)
    return mp ? `${width} × ${height} (${mp})` : `${width} × ${height}`
}

export const aspectRatio = (width: number | null, height: number | null) => {
    if (!width || !height) return null
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
    const divisor = gcd(width, height) || 1
    return `${width / divisor}:${height / divisor}`
}

export const formatCoord = (lat: number, lng: number) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`

const dms = (value: number, positive: string, negative: string) => {
    const hemisphere = value >= 0 ? positive : negative
    const abs = Math.abs(value)
    const degrees = Math.floor(abs)
    const minutesFloat = (abs - degrees) * 60
    const minutes = Math.floor(minutesFloat)
    const seconds = ((minutesFloat - minutes) * 60).toFixed(1)
    return `${degrees}°${minutes}'${seconds}"${hemisphere}`
}

export const formatDms = (lat: number, lng: number) => `${dms(lat, 'N', 'S')} ${dms(lng, 'E', 'W')}`

export const formatEpoch = (milliseconds: number | null) => {
    if (milliseconds == null) return null
    const date = new Date(milliseconds)
    if (Number.isNaN(date.getTime())) return null
    const pad = (value: number) => `${value}`.padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export const formatAltitude = (alt: number, ref: string | null) => {
    const base = `${alt >= 0 ? '+' : ''}${alt.toFixed(1)} m`
    return ref ? `${base} (${ref})` : base
}
