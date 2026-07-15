const floatView = new Float32Array(1)
const intView = new Uint32Array(floatView.buffer)

export const floatToHalf = (value: number) => {
    floatView[0] = value
    const x = intView[0]
    const sign = (x >> 16) & 0x8000
    let mantissa = x & 0x007fffff
    let exponent = (x >> 23) & 0xff
    if (exponent === 0xff) return sign | 0x7c00 | (mantissa !== 0 ? 0x0200 : 0)
    exponent = exponent - 127 + 15
    if (exponent >= 31) return sign | 0x7c00
    if (exponent <= 0) {
        if (exponent < -10) return sign
        mantissa = (mantissa | 0x00800000) >> (1 - exponent)
        return sign | (mantissa >> 13)
    }
    return sign | (exponent << 10) | (mantissa >> 13)
}

export const packHalfArray = (values: Float32Array) => {
    const out = new Uint16Array(values.length)
    for (let i = 0; i < values.length; i++) out[i] = floatToHalf(values[i])
    return out
}
