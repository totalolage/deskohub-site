/**
 * Environment detection utility
 * Intelligently determines if we're in development mode based on context
 */

import { env } from "@/env";

/**
 * Check if the application is running in development mode
 * - Server-side: Uses NODE_ENV environment variable
 * - Client-side: Checks if running on localhost
 */
export function isDev(): boolean {
  if (typeof window === "undefined") {
    // Server-side: use NODE_ENV
    return env.NODE_ENV === "development" || env.VERCEL_ENV === "development";
  }

  // Client-side: check if we're on localhost
  const isLocalhost = 

  (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.startsWith("192.168.") ||
    window.location.hostname.startsWith("10.")
  );

  if (isLocalhost) return true;

  const haveDevCookie = document.cookie.includes("developer=true");
  if (haveDevCookie) return true;

  return false;
}
