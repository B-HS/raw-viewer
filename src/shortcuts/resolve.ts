import { useSettings } from '../store/settings'
import { ACTION_BY_ID, DEFAULT_BINDINGS } from './keymap'
import type { Binding, ShortcutIgnore } from './keymap'

export const resolveBinding = (id: string) => useSettings.getState().shortcutOverrides[id] ?? DEFAULT_BINDINGS[id]

const bindingMatches = (event: KeyboardEvent, binding: Binding, ignore?: ShortcutIgnore[]) =>
    event.code === binding.code &&
    event.metaKey === !!binding.meta &&
    event.ctrlKey === !!binding.ctrl &&
    (ignore?.includes('shift') ? true : event.shiftKey === !!binding.shift) &&
    (ignore?.includes('alt') ? true : event.altKey === !!binding.alt)

export const matchAction = (event: KeyboardEvent, id: string) => bindingMatches(event, resolveBinding(id), ACTION_BY_ID.get(id)?.ignore)
