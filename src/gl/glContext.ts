export type GlContext = {
    gl: WebGL2RenderingContext
    lowPrecision: boolean
    displaySpace: 'display-p3' | 'srgb'
    maxTextureSize: number
}

export const createGlContext = (canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2', {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
    })
    if (!gl) return null

    let displaySpace: 'display-p3' | 'srgb' = 'srgb'
    if ('drawingBufferColorSpace' in gl) {
        try {
            gl.drawingBufferColorSpace = 'display-p3'
        } catch {}
        displaySpace = gl.drawingBufferColorSpace === 'display-p3' ? 'display-p3' : 'srgb'
    }
    if ('unpackColorSpace' in gl) {
        try {
            gl.unpackColorSpace = 'srgb'
        } catch {}
    }

    const floatBuffer = gl.getExtension('EXT_color_buffer_float')
    gl.getExtension('OES_texture_float_linear')

    return {
        gl,
        lowPrecision: !floatBuffer,
        displaySpace,
        maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    }
}

const compileShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('shader alloc failed')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error(`shader compile failed: ${log}`)
    }
    return shader
}

export const createProgram = (gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) => {
    const program = gl.createProgram()
    if (!program) throw new Error('program alloc failed')
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program)
        gl.deleteProgram(program)
        throw new Error(`program link failed: ${log}`)
    }
    return program
}

export const uniformLocations = (gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]) => {
    const map: Record<string, WebGLUniformLocation | null> = {}
    for (const name of names) map[name] = gl.getUniformLocation(program, name)
    return map
}
