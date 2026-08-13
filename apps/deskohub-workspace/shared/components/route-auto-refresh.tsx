"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

type RouteAutoRefreshProps = {
  readonly enabled: boolean;
  readonly intervalMs?: number;
  readonly refreshAt?: string;
  readonly refreshOnFocus?: boolean;
};

const DEFAULT_REFRESH_INTERVAL_MS = 5000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export function RouteAutoRefresh({
  enabled,
  intervalMs = DEFAULT_REFRESH_INTERVAL_MS,
  refreshAt,
  refreshOnFocus = false,
}: RouteAutoRefreshProps) {
  const router = useRouter();
  const refreshRoute = useEffectEvent(() => {
    router.refresh();
  });

  useEffect(() => {
    if (!enabled) return;

    const intervalId = globalThis.setInterval(refreshRoute, intervalMs);

    return () => globalThis.clearInterval(intervalId);
  }, [enabled, intervalMs]);

  useEffect(() => {
    if (!refreshAt) return;

    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      const remainingMs = Date.parse(refreshAt) - Date.now();
      if (remainingMs <= 0) {
        refreshRoute();
        if (!enabled) {
          timeoutId = globalThis.setTimeout(schedule, intervalMs);
        }
        return;
      }
      timeoutId = globalThis.setTimeout(
        schedule,
        Math.min(remainingMs, MAX_TIMEOUT_MS)
      );
    };
    schedule();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    };
  }, [enabled, intervalMs, refreshAt]);

  useEffect(() => {
    if (!refreshOnFocus) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshRoute();
    };
    globalThis.addEventListener("focus", refreshRoute);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      globalThis.removeEventListener("focus", refreshRoute);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshOnFocus]);

  return null;
}
