"use client";

import { useEffect } from "react";
import { refreshAnalyticsAccountIdentity } from "@/features/account/analytics-identity";

/**
 * Companion of the rolling session: Server Components cannot write cookies,
 * so every authenticated account view asks the account identity adapter once,
 * letting it refresh the browser cookie and authoritative identity after the
 * server-side refresh age. The page keeps its authoritative server session
 * checks, and the refresh reports its own failure without rejecting.
 */
export function SessionRefresh() {
  useEffect(() => {
    void refreshAnalyticsAccountIdentity();
  }, []);

  return null;
}
