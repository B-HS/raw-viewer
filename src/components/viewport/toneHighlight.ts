type ToneCapture = (source: HTMLCanvasElement) => void

let capture: ToneCapture | null = null

export const setToneCapture = (next: ToneCapture | null) => {
    capture = next
}

export const runToneCapture = (source: HTMLCanvasElement) => {
    capture?.(source)
}

export const hasToneCapture = () => capture !== null
