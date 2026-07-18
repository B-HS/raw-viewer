import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'

export const checkForUpdate = () => check()

const UPDATE_ERROR_DETAIL_MAX = 140

export const describeUpdateError = (error: unknown) => {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, UPDATE_ERROR_DETAIL_MAX)
    if (/404|not found|could not fetch a valid release/i.test(message)) return { kind: 'noRelease' as const, message }
    if (/network|time[d]? ?out|dns|connect|sending request|fetch/i.test(message)) return { kind: 'network' as const, message }
    return { kind: 'unknown' as const, message }
}

export const installUpdateAndRelaunch = async (update: NonNullable<Awaited<ReturnType<typeof check>>>) => {
    await update.downloadAndInstall()
    await relaunch()
}
