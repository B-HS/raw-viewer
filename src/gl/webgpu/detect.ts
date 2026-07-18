export type WebGpuSupport =
    | { status: 'unavailable'; reason: 'no-navigator-gpu' | 'no-adapter' | 'device-failed' }
    | { status: 'available'; shaderF16: boolean; maxTextureDimension2D: number; adapterInfo: string }

export const detectWebGpuSupport = async (): Promise<WebGpuSupport> => {
    if (typeof navigator === 'undefined' || !navigator.gpu) return { status: 'unavailable', reason: 'no-navigator-gpu' }
    const adapter = await navigator.gpu.requestAdapter().catch(() => null)
    if (!adapter) return { status: 'unavailable', reason: 'no-adapter' }
    const shaderF16 = adapter.features.has('shader-f16')
    const device = await adapter.requestDevice(shaderF16 ? { requiredFeatures: ['shader-f16'] } : undefined).catch(() => null)
    if (!device) return { status: 'unavailable', reason: 'device-failed' }
    const info = adapter.info
    const adapterInfo = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'unknown adapter'
    const maxTextureDimension2D = device.limits.maxTextureDimension2D
    device.destroy()
    return { status: 'available', shaderF16, maxTextureDimension2D, adapterInfo }
}
