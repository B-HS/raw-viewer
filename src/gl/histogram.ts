export type Histogram = { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array }

export type HistogramCallback = (hist: Histogram) => void

const THROTTLE_MS = 150

export const createHistogramService = () => {
    const worker = new Worker(new URL('./histogram.worker.ts', import.meta.url), { type: 'module' })
    const callbacks = new Set<HistogramCallback>()
    let lastSample = 0
    let trailing: ReturnType<typeof setTimeout> | null = null
    let pendingReader: (() => Uint8Array) | null = null

    worker.onmessage = (event) => {
        const hist: Histogram = event.data
        for (const callback of callbacks) callback(hist)
    }

    const dispatch = (reader: () => Uint8Array, now: number) => {
        lastSample = now
        const pixels = reader()
        worker.postMessage({ pixels: pixels.buffer, length: pixels.length }, { transfer: [pixels.buffer] })
    }

    const flushTrailing = () => {
        trailing = null
        if (!pendingReader || callbacks.size === 0) return
        const reader = pendingReader
        pendingReader = null
        dispatch(reader, performance.now())
    }

    const maybeSample = (reader: () => Uint8Array) => {
        if (callbacks.size === 0) return
        const now = performance.now()
        if (now - lastSample >= THROTTLE_MS) {
            dispatch(reader, now)
            return
        }
        pendingReader = reader
        if (trailing == null) trailing = setTimeout(flushTrailing, THROTTLE_MS - (now - lastSample))
    }

    const onHistogram = (callback: HistogramCallback) => {
        callbacks.add(callback)
        return () => {
            callbacks.delete(callback)
        }
    }

    const hasSubscribers = () => callbacks.size > 0

    const dispose = () => {
        if (trailing != null) clearTimeout(trailing)
        trailing = null
        pendingReader = null
        callbacks.clear()
        worker.terminate()
    }

    return { onHistogram, maybeSample, hasSubscribers, dispose }
}

export type HistogramService = ReturnType<typeof createHistogramService>
