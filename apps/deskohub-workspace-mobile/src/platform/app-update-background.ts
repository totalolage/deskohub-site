import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { checkAndDownloadApkUpdate } from "./app-updates";

const APK_UPDATE_TASK = "deskohub-workspace-apk-update";

if (Platform.OS === "android" && !TaskManager.isTaskDefined(APK_UPDATE_TASK)) {
  TaskManager.defineTask(APK_UPDATE_TASK, async () => {
    try {
      await checkAndDownloadApkUpdate();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerApkUpdateTask(): Promise<void> {
  if (Platform.OS !== "android" || !(await TaskManager.isAvailableAsync()))
    return;
  if (await TaskManager.isTaskRegisteredAsync(APK_UPDATE_TASK)) return;
  await BackgroundTask.registerTaskAsync(APK_UPDATE_TASK, {
    minimumInterval: 60,
  });
}
