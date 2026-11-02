type EnvironmentConfig = {
  nodeEnv?: string;
  vercelEnv?: string;
  hostname?: string;
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
const PRIVATE_NETWORK_PREFIXES = ["192.168.", "10."];

/** Whether `hostname` is this machine or an address on a private network. */
export function isLocalHostname(hostname: string | undefined): boolean {
  if (hostname === undefined) return false;
  return (
    LOCAL_HOSTNAMES.has(hostname) ||
    PRIVATE_NETWORK_PREFIXES.some((prefix) => hostname.startsWith(prefix))
  );
}

function browserHostname(): string | undefined {
  return typeof window !== "undefined" ? window.location.hostname : undefined;
}

export function isDev(config: EnvironmentConfig = {}): boolean {
  const nodeEnv = config.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv === "development") return true;

  const vercelEnv = config.vercelEnv ?? process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv === "development") return true;

  return isLocalHostname(config.hostname ?? browserHostname());
}
