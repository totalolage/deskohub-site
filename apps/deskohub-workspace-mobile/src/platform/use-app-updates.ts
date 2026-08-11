import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import type { AppUpdateState } from "../domain/shop";
import { registerApkUpdateTask } from "./app-update-background";
import {
  checkAndDownloadApkUpdate,
  checkForSmallUpdate,
  installReadyApkUpdate,
} from "./app-updates";

export type UseAppUpdatesResult = Readonly<{
  state: AppUpdateState;
  check(): Promise<void>;
  apply(): Promise<void>;
}>;

export function useAppUpdates(): UseAppUpdatesResult {
  const [state, setState] = useState<AppUpdateState>({
    kind: "current",
    checkedAt: new Date(0).toISOString(),
  });

  const check = useCallback(async () => {
    try {
      if (await checkForSmallUpdate()) {
        setState({ kind: "small_update_ready" });
        return;
      }

      const apkResult = await checkAndDownloadApkUpdate();
      if (apkResult.kind === "waiting_for_wifi") {
        setState({ kind: "apk_update_waiting_for_wifi" });
      } else if (apkResult.kind === "ready") {
        setState({ kind: "applying" });
      } else {
        setState({ kind: "current", checkedAt: new Date().toISOString() });
      }
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  const apply = useCallback(async () => {
    setState({ kind: "applying" });
    try {
      if (!(await installReadyApkUpdate())) await check();
    } catch {
      setState({ kind: "error" });
    }
  }, [check]);

  useEffect(() => {
    void registerApkUpdateTask();
    void check();
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void check();
    });
    return () => subscription.remove();
  }, [check]);

  return { state, check, apply };
}
