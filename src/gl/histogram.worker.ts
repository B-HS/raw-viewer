type HistogramRequest = { pixels: ArrayBuffer; length: number }

self.onmessage = (event) => {
    const request: HistogramRequest = event.data
    const data = new Uint8Array(request.pixels, 0, request.length)
    const r = new Uint32Array(256)
    const g = new Uint32Array(256)
    const b = new Uint32Array(256)
    const luma = new Uint32Array(256)
    for (let i = 0; i + 3 < data.length; i += 4) {
        r[data[i]]++
        g[data[i + 1]]++
        b[data[i + 2]]++
        luma[data[i + 3]]++
    }
    self.postMessage({ r, g, b, luma }, { transfer: [r.buffer, g.buffer, b.buffer, luma.buffer] })
}
