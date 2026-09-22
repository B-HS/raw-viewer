export const EDITOR_TOOLS = [
    { id: 'move', key: 'V', path: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3' },
    { id: 'lasso', key: 'L', path: 'M5 16c-7-8 5-16 13-10 8 7-4 17-10 12-4-3 2-7 4-3 2 4-2 8-5 7' },
    { id: 'brush', key: 'B', path: 'm9 14 9-11 3 3-11 9M9 14c-7-2-3 5-7 6 7 2 10-2 7-6Z' },
    { id: 'pencil', key: 'N', path: 'm4 16 12-12 4 4L8 20l-5 1 1-5Zm10-10 4 4M4 16l4 4' },
    { id: 'eraser', key: 'E', path: 'm3 14 10-11 8 7-10 11H9l-6-7Zm5-6 8 7M11 21h10' },
    { id: 'fill', key: 'G', path: 'm4 11 7-7 9 9-8 8-8-10Zm0 0h14M7 2l6 7M21 15s-3 4-1 5c4 2 2-4 1-5Z' },
    { id: 'clone', key: 'S', path: 'M9 13v-2c-5-6-2-9 1-9h4c3 0 6 3 1 9v2M5 13h14l2 6H3l2-6ZM5 22h14' },
    { id: 'blur', key: 'R', path: 'M12 2S4 11 4 16a8 8 0 0 0 16 0c0-5-8-14-8-14ZM8 15c0 3 1 4 4 5' },
    { id: 'line', key: 'U', path: 'M4 20 20 4' },
    { id: 'arrow', key: 'A', path: 'M4 20 20 4M9 4h11v11' },
    { id: 'rect', key: 'M', path: 'M4 4h16v16H4Z' },
    { id: 'ellipse', key: 'O', path: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z' },
    { id: 'text', key: 'T', path: 'M4 6V3h16v3M12 3v18M8 21h8' },
    {
        id: 'hand',
        key: 'H',
        path: 'M7 12V7a2 2 0 0 1 4 0V4a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v3a2 2 0 0 1 3 1v6c0 4-3 6-7 6-3 0-5-2-7-4l-5-6a2 2 0 0 1 3-2l1 2Z',
    },
] as const

export const EDITOR_SIZE = { min: 0.2, max: 20, step: 0.1, keyboardStep: 0.5 } as const
export const EDITOR_PERCENT = 100
export const EDITOR_NUDGE_PX = 1
export const EDITOR_NUDGE_LARGE_PX = 10
export const EDITOR_LAYER_NAME_MAX = 120
export const EDITOR_PREVIEW_WIDTH = 80
export const EDITOR_PREVIEW_HEIGHT = 56
