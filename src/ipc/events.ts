import { listen } from '@tauri-apps/api/event'
import type { DecodeFailedPayload } from '../types/DecodeFailedPayload'
import type { FsChangedPayload } from '../types/FsChangedPayload'
import type { LevelReadyPayload } from '../types/LevelReadyPayload'

export const onLevelReady = (handler: (payload: LevelReadyPayload) => void) =>
    listen<LevelReadyPayload>('image:level-ready', (event) => handler(event.payload))

export const onDecodeFailed = (handler: (payload: DecodeFailedPayload) => void) =>
    listen<DecodeFailedPayload>('image:decode-failed', (event) => handler(event.payload))

export const onFsChanged = (handler: (payload: FsChangedPayload) => void) => listen<FsChangedPayload>('fs:changed', (event) => handler(event.payload))
