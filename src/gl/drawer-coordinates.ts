import type { DrawerTransform } from '../types/DrawerTransform'

const PERCENT = 100
const DEGREES_HALF_TURN = 180
const CENTER = 0.5

type Point = [number, number]

export const drawerPointToLocal = (point: Point, transform: DrawerTransform | null, width: number, height: number): Point => {
    if (!transform) return point
    const angle = (transform.rotate * Math.PI) / DEGREES_HALF_TURN
    const scale = transform.scale / PERCENT
    const x = (point[0] - CENTER - transform.offsetX / PERCENT) * width
    const y = (point[1] - CENTER - transform.offsetY / PERCENT) * height
    return [
        (Math.cos(angle) * x + Math.sin(angle) * y) / scale / width + CENTER,
        (-Math.sin(angle) * x + Math.cos(angle) * y) / scale / height + CENTER,
    ]
}
