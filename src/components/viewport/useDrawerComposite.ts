import { useEffect } from 'react'
import { drawerNeedsPhoto, renderDrawerCanvas } from '../../gl/drawerRaster'
import { useEditStore } from '../../store/editStore'
import { usePlaylist } from '../../store/playlist'
import type { EngineApi } from '../../gl/engineApi'

export const useDrawerComposite = (engine: EngineApi | null) => {
    useEffect(() => {
        if (!engine) return
        let raf: number | null = null
        let lastDrawer: unknown = null
        let lastState: unknown = null
        let lastLevelKey = ''

        const rasterize = () => {
            raf = null
            const playlist = usePlaylist.getState()
            const current = playlist.entries[playlist.currentIndex]
            const level = current ? playlist.best[current.imageId] : undefined
            const drawer = useEditStore.getState().state?.drawer
            const photo = drawer && drawerNeedsPhoto(drawer) ? engine.readProcessedSrgb() : null
            engine.setDrawerCanvas(level && drawer ? renderDrawerCanvas(drawer, level.width, level.height, photo) : null)
        }

        const sync = () => {
            const playlist = usePlaylist.getState()
            const current = playlist.entries[playlist.currentIndex]
            const level = current ? playlist.best[current.imageId] : undefined
            const editState = useEditStore.getState().state
            const drawer = editState?.drawer ?? null
            const levelKey = current && level ? `${current.imageId}:${level.width}x${level.height}` : ''
            const photoDirty = drawerNeedsPhoto(drawer) && editState !== lastState
            if (drawer === lastDrawer && levelKey === lastLevelKey && !photoDirty) return
            lastDrawer = drawer
            lastState = editState
            lastLevelKey = levelKey
            if (raf === null) raf = requestAnimationFrame(rasterize)
        }

        sync()
        const unsubEdit = useEditStore.subscribe(sync)
        const unsubPlaylist = usePlaylist.subscribe(sync)
        return () => {
            unsubEdit()
            unsubPlaylist()
            if (raf !== null) cancelAnimationFrame(raf)
            engine.setDrawerCanvas(null)
        }
    }, [engine])
}
