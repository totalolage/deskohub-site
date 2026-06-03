"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

type CheckoutStatusAutoRefreshProps = {
  readonly enabled: boolean;
  readonly intervalMs?: number;
};

const DEFAULT_STATUS_REFRESH_INTERVAL_MS = 5000;

export function CheckoutStatusAutoRefresh({
  enabled,
  intervalMs = DEFAULT_STATUS_REFRESH_INTERVAL_MS,
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

  return null;
}
