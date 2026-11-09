"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

type RouteAutoRefreshProps = {
  readonly enabled: boolean;
  readonly intervalMs?: number;
  readonly refreshAt?: string;
  readonly refreshOnFocus?: boolean;
};

const DEFAULT_REFRESH_INTERVAL_MS = 10_000;
const POLL_BACKOFF_MS = [2000, 3000, 5000, 8000];
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Refreshes the current route while `enabled`. Each poll waits for the
 * previous refresh to finish, backs off up to `intervalMs`, and pauses while
 * the document is hidden. Returning to the tab refreshes as soon as any
 * in-flight refresh finishes and restarts the backoff. Refreshes never overlap.
 */
export function RouteAutoRefresh({
  enabled,
  intervalMs = DEFAULT_REFRESH_INTERVAL_MS,
  refreshAt,
  refreshOnFocus = false,
}: RouteAutoRefreshProps) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [pollAttempt, setPollAttempt] = useState(0);
  const [isVisibleRefreshPending, setVisibleRefreshPending] = useState(false);
  const isDocumentVisible = useSyncExternalStore(
    subscribeToDocumentVisibility,
    () => document.visibilityState === "visible",
    () => true
  );
  const refreshRoute = useEffectEvent(() => {
    if (isRefreshing) return;
    startRefresh(() => router.refresh());
  });

  useEffect(() => {
    if (!enabled || !isDocumentVisible || isRefreshing) return;

    const timeoutId = globalThis.setTimeout(
      () => {
        if (isVisibleRefreshPending) setVisibleRefreshPending(false);
        else
          setPollAttempt((attempt) =>
            Math.min(attempt + 1, POLL_BACKOFF_MS.length)
          );
        refreshRoute();
      },
      isVisibleRefreshPending
        ? 0
        : Math.min(POLL_BACKOFF_MS[pollAttempt] ?? intervalMs, intervalMs)
    );

    return () => globalThis.clearTimeout(timeoutId);
  }, [
    enabled,
    intervalMs,
    isDocumentVisible,
    isRefreshing,
    isVisibleRefreshPending,
    pollAttempt,
  ]);

  useEffect(() => {
    if (!enabled) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      setPollAttempt(0);
      setVisibleRefreshPending(true);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () =>
      document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [enabled]);

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

function subscribeToDocumentVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
