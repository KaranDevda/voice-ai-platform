import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { createApi, SyncQueue } from "../../../packages/mobile-core/src";
import { collectNewCalls } from "./androidCalls";
import { loadPairing, store } from "./session";

export const SYNC_TASK = "bizfy-sync-calls";

/**
 * Runs while the app is closed (the system decides when, at most every 15 minutes, and less often on low battery). It does the same
 * as the Sync button: read the work SIM's new calls into the offline queue, then upload. Safe to overlap with the open app, because the
 * server saves each call once.
 */
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    const pairing = await loadPairing();
    if (!pairing) return BackgroundTask.BackgroundTaskResult.Success;
    const queue = new SyncQueue(store);
    if (Platform.OS === "android") await collectNewCalls(queue);
    const r = await queue.flush(createApi({ baseUrl: pairing.baseUrl, token: pairing.token }));
    return r.state === "offline" ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function startBackgroundSync(): Promise<void> {
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(SYNC_TASK))) await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 });
  } catch { /* the system may refuse (battery saver, simulator); syncing while the app is open still works */ }
}

export async function stopBackgroundSync(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
  } catch { /* nothing to stop */ }
}
