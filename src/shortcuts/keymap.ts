export const KEYMAP = {
    zoom: {
        toggleFit: 'KeyZ',
        fit: 'Digit0',
        actual: 'Digit1',
        double: 'Digit2',
    },
    pan: {
        modifier: 'Space',
    },
    tool: {
        aspect: 'KeyA',
        swap: 'KeyX',
        overlay: 'KeyO',
    },
} as const

export const PAGE_STEP = 10

export const DIGIT_CODES = ['Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'] as const

export const digitValue = (code: string) => (DIGIT_CODES as readonly string[]).indexOf(code)

export const isEditableTarget = (element: Element | null) =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && element.isContentEditable)

export type Binding = { code: string; meta?: boolean; shift?: boolean; alt?: boolean; ctrl?: boolean }

export type ShortcutSection = 'navigate' | 'view' | 'edit' | 'clipboard' | 'organize' | 'tool' | 'compare' | 'file' | 'export'

export type ShortcutIgnore = 'shift' | 'alt'

export type ShortcutAction = {
    id: string
    section: ShortcutSection
    label: string
    binding: Binding
    ignore?: ShortcutIgnore[]
}

export const SHORTCUT_SECTIONS: readonly ShortcutSection[] = [
    'navigate',
    'view',
    'edit',
    'clipboard',
    'organize',
    'tool',
    'compare',
    'file',
    'export',
]

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
    { id: 'nav.previous', section: 'navigate', label: 'shortcut.navPrevious', binding: { code: 'ArrowLeft' } },
    { id: 'nav.next', section: 'navigate', label: 'shortcut.navNext', binding: { code: 'ArrowRight' } },
    { id: 'nav.first', section: 'navigate', label: 'shortcut.navFirst', binding: { code: 'Home' } },
    { id: 'nav.last', section: 'navigate', label: 'shortcut.navLast', binding: { code: 'End' } },
    { id: 'nav.pageBack', section: 'navigate', label: 'shortcut.navPageBack', binding: { code: 'PageUp' } },
    { id: 'nav.pageForward', section: 'navigate', label: 'shortcut.navPageForward', binding: { code: 'PageDown' } },
    { id: 'view.grid', section: 'view', label: 'shortcut.viewGrid', binding: { code: 'KeyG' } },
    { id: 'view.editPanel', section: 'view', label: 'shortcut.viewEditPanel', binding: { code: 'Tab' } },
    { id: 'view.filmstrip', section: 'view', label: 'shortcut.viewFilmstrip', binding: { code: 'Tab', shift: true } },
    { id: 'view.metaPanel', section: 'view', label: 'shortcut.viewMetaPanel', binding: { code: 'KeyI' } },
    { id: 'view.history', section: 'view', label: 'shortcut.viewHistory', binding: { code: 'KeyZ', meta: true, alt: true } },
    { id: 'view.palette', section: 'view', label: 'shortcut.viewPalette', binding: { code: 'KeyP', meta: true, shift: true } },
    { id: 'view.settings', section: 'view', label: 'shortcut.viewSettings', binding: { code: 'Comma', meta: true } },
    { id: 'edit.undo', section: 'edit', label: 'shortcut.editUndo', binding: { code: 'KeyZ', meta: true } },
    { id: 'edit.redo', section: 'edit', label: 'shortcut.editRedo', binding: { code: 'KeyZ', meta: true, shift: true } },
    { id: 'edit.reset', section: 'edit', label: 'shortcut.editReset', binding: { code: 'KeyR', meta: true }, ignore: ['alt'] },
    { id: 'edit.rotateLeft', section: 'edit', label: 'shortcut.editRotateLeft', binding: { code: 'BracketLeft', meta: true } },
    { id: 'edit.rotateRight', section: 'edit', label: 'shortcut.editRotateRight', binding: { code: 'BracketRight', meta: true } },
    { id: 'clip.copyImage', section: 'clipboard', label: 'shortcut.clipCopyImage', binding: { code: 'KeyC', meta: true } },
    { id: 'clip.copyFiles', section: 'clipboard', label: 'shortcut.clipCopyFiles', binding: { code: 'KeyC', meta: true, alt: true } },
    { id: 'clip.copyPath', section: 'clipboard', label: 'shortcut.clipCopyPath', binding: { code: 'KeyC', meta: true, shift: true, alt: true } },
    { id: 'clip.copyEdit', section: 'clipboard', label: 'shortcut.clipCopyEdit', binding: { code: 'KeyC', meta: true, shift: true } },
    { id: 'clip.pasteEdit', section: 'clipboard', label: 'shortcut.clipPasteEdit', binding: { code: 'KeyV', meta: true, shift: true } },
    { id: 'clip.pastePrevious', section: 'clipboard', label: 'shortcut.clipPastePrevious', binding: { code: 'KeyV', meta: true, alt: true } },
    { id: 'organize.flagPick', section: 'organize', label: 'shortcut.organizeFlagPick', binding: { code: 'KeyP' } },
    { id: 'organize.flagReject', section: 'organize', label: 'shortcut.organizeFlagReject', binding: { code: 'KeyX' } },
    { id: 'organize.flagClear', section: 'organize', label: 'shortcut.organizeFlagClear', binding: { code: 'KeyU' } },
    { id: 'tool.crop', section: 'tool', label: 'shortcut.toolCrop', binding: { code: 'KeyC' } },
    { id: 'tool.eyedropper', section: 'tool', label: 'shortcut.toolEyedropper', binding: { code: 'KeyW' } },
    { id: 'inspect.clip', section: 'tool', label: 'shortcut.inspectClip', binding: { code: 'KeyJ' }, ignore: ['shift', 'alt'] },
    { id: 'inspect.before', section: 'tool', label: 'shortcut.inspectBefore', binding: { code: 'Backslash' }, ignore: ['shift', 'alt'] },
    { id: 'compare.split', section: 'compare', label: 'shortcut.compareSplit', binding: { code: 'KeyY' }, ignore: ['shift', 'alt'] },
    { id: 'file.open', section: 'file', label: 'shortcut.fileOpen', binding: { code: 'KeyO', meta: true } },
    { id: 'file.reveal', section: 'file', label: 'shortcut.fileReveal', binding: { code: 'KeyR', meta: true, shift: true } },
    { id: 'file.selectAll', section: 'file', label: 'shortcut.fileSelectAll', binding: { code: 'KeyA', meta: true } },
    { id: 'file.trash', section: 'file', label: 'shortcut.fileTrash', binding: { code: 'Backspace' } },
    { id: 'export.raster', section: 'export', label: 'shortcut.exportRaster', binding: { code: 'KeyE', meta: true }, ignore: ['shift'] },
    { id: 'export.dng', section: 'export', label: 'shortcut.exportDng', binding: { code: 'KeyD', meta: true, shift: true } },
] as const

export const ACTION_BY_ID = new Map(SHORTCUT_ACTIONS.map((action) => [action.id, action]))

export const DEFAULT_BINDINGS: Record<string, Binding> = Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action.id, action.binding]))

const isBinding = (value: unknown): value is Binding => typeof value === 'object' && value !== null && typeof (value as Binding).code === 'string'

export const sanitizeOverrides = (value: unknown): Record<string, Binding> => {
    if (typeof value !== 'object' || value === null) return {}
    const result: Record<string, Binding> = {}
    for (const [id, binding] of Object.entries(value as Record<string, unknown>)) {
        if (ACTION_BY_ID.has(id) && isBinding(binding))
            result[id] = { code: binding.code, meta: !!binding.meta, shift: !!binding.shift, alt: !!binding.alt, ctrl: !!binding.ctrl }
    }
    return result
}

const MODIFIER_CODES = new Set([
    'MetaLeft',
    'MetaRight',
    'ShiftLeft',
    'ShiftRight',
    'AltLeft',
    'AltRight',
    'ControlLeft',
    'ControlRight',
    'OSLeft',
    'OSRight',
    'CapsLock',
])

export const eventToBinding = (event: KeyboardEvent): Binding | null => {
    if (MODIFIER_CODES.has(event.code)) return null
    return { code: event.code, meta: event.metaKey, shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey }
}

export const serializeBinding = (binding: Binding) =>
    `${binding.code}|${binding.meta ? 1 : 0}${binding.shift ? 1 : 0}${binding.alt ? 1 : 0}${binding.ctrl ? 1 : 0}`

export const bindingsEqual = (a: Binding, b: Binding) => serializeBinding(a) === serializeBinding(b)

export const activeConflicts = (overrides: Record<string, Binding>): Set<string> => {
    const byBinding = new Map<string, string[]>()
    for (const action of SHORTCUT_ACTIONS) {
        const key = serializeBinding(overrides[action.id] ?? action.binding)
        const list = byBinding.get(key)
        if (list) list.push(action.id)
        else byBinding.set(key, [action.id])
    }
    const conflicting = new Set<string>()
    for (const ids of byBinding.values()) if (ids.length > 1) for (const id of ids) conflicting.add(id)
    return conflicting
}

const KEY_SYMBOLS: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Home: 'Home',
    End: 'End',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    Space: 'Space',
    Tab: '⇥',
    Enter: '⏎',
    Escape: 'Esc',
    Backspace: '⌫',
    Delete: '⌦',
}

const codeSymbol = (code: string) => {
    if (KEY_SYMBOLS[code]) return KEY_SYMBOLS[code]
    if (code.startsWith('Key')) return code.slice(3)
    if (code.startsWith('Digit')) return code.slice(5)
    if (code.startsWith('Numpad')) return `${code.slice(6)}`
    if (code.startsWith('F') && /^F\d+$/.test(code)) return code
    return code
}

export const formatBinding = (binding: Binding) =>
    `${binding.ctrl ? '⌃' : ''}${binding.alt ? '⌥' : ''}${binding.shift ? '⇧' : ''}${binding.meta ? '⌘' : ''}${codeSymbol(binding.code)}`
