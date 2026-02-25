type EnvironmentConfig = {
  nodeEnv?: string;
  vercelEnv?: string;
  hostname?: string;
};

export function isDev(config: EnvironmentConfig = {}): boolean {
  const nodeEnv = config.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv === "development") return true;

  const vercelEnv = config.vercelEnv ?? process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv === "development") return true;

  const hostname =
    config.hostname ??
    (typeof window !== "undefined" ? window.location.hostname : undefined);

  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname?.startsWith("192.168.") ||
    hostname?.startsWith("10.");
  if (isLocalhost) return true;

  return false;
}
