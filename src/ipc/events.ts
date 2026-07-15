import { listen } from '@tauri-apps/api/event'
import type { CpuFrameReadyPayload } from '../types/CpuFrameReadyPayload'
import type { DecodeCrashLoopPayload } from '../types/DecodeCrashLoopPayload'
import type { DecodeFailedPayload } from '../types/DecodeFailedPayload'
import type { FsChangedPayload } from '../types/FsChangedPayload'
import type { LevelReadyPayload } from '../types/LevelReadyPayload'
import type { OpenRequestPayload } from '../types/OpenRequestPayload'

export const onLevelReady = (handler: (payload: LevelReadyPayload) => void) =>
    listen<LevelReadyPayload>('image:level-ready', (event) => handler(event.payload))

export const onDecodeCrashLoop = (handler: (payload: DecodeCrashLoopPayload) => void) =>
    listen<DecodeCrashLoopPayload>('decode:crash-loop', (event) => handler(event.payload))

export const onDecodeFailed = (handler: (payload: DecodeFailedPayload) => void) =>
    listen<DecodeFailedPayload>('image:decode-failed', (event) => handler(event.payload))

export const onFsChanged = (handler: (payload: FsChangedPayload) => void) => listen<FsChangedPayload>('fs:changed', (event) => handler(event.payload))

export const onOpenRequest = (handler: (payload: OpenRequestPayload) => void) =>
    listen<OpenRequestPayload>('file:open-request', (event) => handler(event.payload))

export const onDockOpen = (handler: (payload: OpenRequestPayload) => void) =>
    listen<OpenRequestPayload>('dock:open', (event) => handler(event.payload))

export const onRecentsChanged = (handler: () => void) => listen('recents:changed', () => handler())

export const onCpuFrameReady = (handler: (payload: CpuFrameReadyPayload) => void) =>
    listen<CpuFrameReadyPayload>('cpu:frame-ready', (event) => handler(event.payload))
