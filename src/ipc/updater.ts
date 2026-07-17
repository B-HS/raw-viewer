import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'

export const checkForUpdate = () => check()

export const installUpdateAndRelaunch = async (update: NonNullable<Awaited<ReturnType<typeof check>>>) => {
    await update.downloadAndInstall()
    await relaunch()
}
