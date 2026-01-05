import { headers } from "next/headers";
import { use } from "react";
export function isDev(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (process.env.VERCEL_ENV === "development") return true;

  let hostname: string | undefined;

  if (typeof window === "undefined")
    hostname = use(headers()).get("host")?.split(":")[0];
  else hostname = window.location.hostname;

  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname?.startsWith("192.168.") ||
    hostname?.startsWith("10.");
  if (isLocalhost) return true;

  return false;
}
