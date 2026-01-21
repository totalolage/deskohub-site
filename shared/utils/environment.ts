import { env } from "@/env";

export function isDev(): boolean {
  if (env.NEXT_PUBLIC_NODE_ENV === "development") return true;
  if (env.NEXT_PUBLIC_VERCEL_ENV === "development") return true;

  let hostname: string | undefined;
  if (typeof window !== "undefined") hostname = window.location.hostname;

  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname?.startsWith("192.168.") ||
    hostname?.startsWith("10.");
  if (isLocalhost) return true;

  return false;
}
