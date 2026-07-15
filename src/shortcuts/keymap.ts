export const KEYMAP = {
    navigate: {
        previous: 'ArrowLeft',
        next: 'ArrowRight',
        first: 'Home',
        last: 'End',
        pageBack: 'PageUp',
        pageForward: 'PageDown',
    },
    zoom: {
        toggleFit: 'KeyZ',
        fit: 'Digit0',
        actual: 'Digit1',
        double: 'Digit2',
    },
    pan: {
        modifier: 'Space',
    },
    view: {
        togglePanel: 'Tab',
    },
    edit: {
        undo: 'KeyZ',
        redo: 'KeyZ',
        resetAll: 'KeyR',
        resetSection: 'KeyR',
    },
    inspect: {
        clip: 'KeyJ',
        before: 'Backslash',
    },
    compare: {
        split: 'KeyY',
    },
    tool: {
        crop: 'KeyC',
        aspect: 'KeyA',
        swap: 'KeyX',
        overlay: 'KeyO',
        eyedropper: 'KeyW',
        rotateLeft: 'BracketLeft',
        rotateRight: 'BracketRight',
    },
    organize: {
        flagPick: 'KeyP',
        flagReject: 'KeyX',
        flagClear: 'KeyU',
    },
    panel: {
        meta: 'KeyI',
        filmstrip: 'KeyF',
    },
    file: {
        open: 'KeyO',
        reveal: 'KeyR',
    },
    clipboard: {
        copyEdit: 'KeyC',
        pasteEdit: 'KeyV',
        pastePrevious: 'KeyV',
    },
    export: {
        raster: 'KeyE',
        dng: 'KeyD',
    },
    trash: {
        move: 'Backspace',
        remove: 'Delete',
    },
} as const

export const PAGE_STEP = 10

export const DIGIT_CODES = ['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'] as const

export const digitValue = (code: string) => (DIGIT_CODES as readonly string[]).indexOf(code)

export const isEditableTarget = (element: Element | null) =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable)

export type KeymapSection = keyof typeof KEYMAP
