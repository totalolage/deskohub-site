"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

type CheckoutStatusAutoRefreshProps = {
  readonly enabled: boolean;
  readonly intervalMs?: number;
  readonly refreshAt?: string;
  readonly refreshOnFocus?: boolean;
};

const DEFAULT_STATUS_REFRESH_INTERVAL_MS = 5000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export function CheckoutStatusAutoRefresh({
  enabled,
  intervalMs = DEFAULT_STATUS_REFRESH_INTERVAL_MS,
  refreshAt,
  refreshOnFocus = false,
}: CheckoutStatusAutoRefreshProps) {
  const router = useRouter();
  const refreshStatus = useEffectEvent(() => {
    router.refresh();
  });

  useEffect(() => {
    if (!enabled) return;

    const intervalId = globalThis.setInterval(refreshStatus, intervalMs);

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
        refreshStatus();
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
  }, [refreshAt]);

  useEffect(() => {
    if (!refreshOnFocus) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshStatus();
    };
    globalThis.addEventListener("focus", refreshStatus);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      globalThis.removeEventListener("focus", refreshStatus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshOnFocus]);

  return null;
}
