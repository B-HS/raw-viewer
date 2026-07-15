export const TILE_SIZE = 2048
export const TILE_OVERLAP = 32

export type Tile = {
    sx0: number
    sy0: number
    coreW: number
    coreH: number
    texX0: number
    texY0: number
    texW: number
    texH: number
    overlapL: number
    overlapT: number
}

let maxTextureOverride: number | null = null

export const setMaxTextureSizeOverride = (px: number | null) => {
    maxTextureOverride = px
}

export const effectiveMaxTexture = (glMax: number) => (maxTextureOverride != null ? Math.min(glMax, maxTextureOverride) : glMax)

export const needsTiling = (width: number, height: number, glMax: number) => Math.max(width, height) > effectiveMaxTexture(glMax)

export const planTiles = (width: number, height: number, tileSize = TILE_SIZE, overlap = TILE_OVERLAP) => {
    const stride = Math.max(1, tileSize - 2 * overlap)
    const tiles: Tile[] = []
    for (let sy0 = 0; sy0 < height; sy0 += stride) {
        const coreH = Math.min(stride, height - sy0)
        const texY0 = Math.max(0, sy0 - overlap)
        const texY1 = Math.min(height, sy0 + coreH + overlap)
        for (let sx0 = 0; sx0 < width; sx0 += stride) {
            const coreW = Math.min(stride, width - sx0)
            const texX0 = Math.max(0, sx0 - overlap)
            const texX1 = Math.min(width, sx0 + coreW + overlap)
            tiles.push({
                sx0,
                sy0,
                coreW,
                coreH,
                texX0,
                texY0,
                texW: texX1 - texX0,
                texH: texY1 - texY0,
                overlapL: sx0 - texX0,
                overlapT: sy0 - texY0,
            })
        }
    }
    return tiles
}

export const extractTile = (data: Uint16Array, width: number, tile: Tile, channels = 3) => {
    const out = new Uint16Array(tile.texW * tile.texH * channels)
    for (let row = 0; row < tile.texH; row++) {
        const srcRow = (tile.texY0 + row) * width + tile.texX0
        const dstRow = row * tile.texW
        for (let col = 0; col < tile.texW; col++) {
            const srcIndex = (srcRow + col) * channels
            const dstIndex = (dstRow + col) * channels
            for (let ch = 0; ch < channels; ch++) out[dstIndex + ch] = data[srcIndex + ch]
        }
    }
    return out
}
