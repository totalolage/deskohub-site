"use client";

import { useEffect } from "react";
import { authClient } from "@/features/account/auth.client";

/**
 * Companion of the rolling session: Server Components cannot write cookies,
 * so every authenticated account view asks the mounted get-session route
 * handler once, letting it refresh the browser cookie after the server-side
 * refresh age. The page keeps its authoritative server session checks, the
 * response stays unused, and a failed request is swallowed so it never turns
 * into an unhandled rejection.
 */
export function SessionRefresh() {
  useEffect(() => {
    authClient.getSession().catch(() => undefined);
  }, []);

  return null;
}
