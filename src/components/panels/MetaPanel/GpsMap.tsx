import 'leaflet/dist/leaflet.css'
import * as L from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import type { GpsMeta } from '../../../types/GpsMeta'

const markerHtml = (direction: number | null) =>
    direction == null
        ? '<div style="width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.6)"></div>'
        : `<div style="transform:rotate(${direction}deg);width:14px;height:14px"><div style="margin:0 auto;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:14px solid #ef4444;filter:drop-shadow(0 0 2px rgba(0,0,0,.7))"></div></div>`

export const GpsMap: FC<{ gps: GpsMeta }> = ({ gps }) => {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const map = L.map(container, { center: [gps.lat, gps.lng], zoom: 14, zoomControl: false })
        const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' })
        let loaded = false
        tiles.on('load', () => {
            loaded = true
        })
        tiles.on('tileerror', () => {
            if (!loaded) setFailed(true)
        })
        tiles.addTo(map)
        const icon = L.divIcon({ className: '', html: markerHtml(gps.direction ?? null), iconSize: [14, 14], iconAnchor: [7, 7] })
        L.marker([gps.lat, gps.lng], { icon }).addTo(map)
        const invalidate = requestAnimationFrame(() => map.invalidateSize())
        const timer = setTimeout(() => {
            if (!loaded) setFailed(true)
        }, 6000)
        return () => {
            cancelAnimationFrame(invalidate)
            clearTimeout(timer)
            map.remove()
        }
    }, [gps.lat, gps.lng, gps.direction])

    return (
        <div className='relative mx-3 mb-2 h-[200px] overflow-hidden rounded border border-neutral-700'>
            <div ref={containerRef} className='h-full w-full' />
            {failed && (
                <div className='absolute inset-0 flex items-center justify-center bg-neutral-900/90 px-3 text-center text-[11px] text-neutral-400'>
                    지도를 불러올 수 없습니다
                </div>
            )}
        </div>
    )
}
