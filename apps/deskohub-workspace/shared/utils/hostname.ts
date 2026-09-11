export function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
}
