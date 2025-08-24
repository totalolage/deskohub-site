import { env } from "@/env";
export function isDev(): boolean {
  if (typeof window === "undefined") {
    return env.NODE_ENV === "development" || env.VERCEL_ENV === "development";
  }
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.startsWith("192.168.") ||
    window.location.hostname.startsWith("10.");

  if (isLocalhost) return true;

  const haveDevCookie = document.cookie.includes("developet=true");
  if (haveDevCookie) return true;

  return false;
}
