export type ZoomCommand = 'fit' | 'actual' | 'double' | 'toggleFit' | { ratio: number }

const listeners = new Set<(command: ZoomCommand) => void>()

export const onZoomCommand = (handler: (command: ZoomCommand) => void) => {
    listeners.add(handler)
    return () => listeners.delete(handler)
}

export const requestZoom = (command: ZoomCommand) => {
    for (const handler of listeners) handler(command)
}
