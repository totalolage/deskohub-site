"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent } from "react";

type CheckoutAutoRefreshProps = {
  readonly enabled: boolean;
  readonly intervalMs?: number;
};

const DEFAULT_CHECKOUT_REFRESH_INTERVAL_MS = 5000;

export function CheckoutAutoRefresh({
  enabled,
  intervalMs = DEFAULT_CHECKOUT_REFRESH_INTERVAL_MS,
}: CheckoutAutoRefreshProps) {
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
