import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePostgresConnectionUrl } from "../db/postgres-connection-url";
import { redact } from "./redaction";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const workspaceDir = resolve(scriptDir, "..");

export const assertSafeDatabaseUrl = (
  databaseUrl: string,
  label: string,
  databaseAllowlist: string
) => {
  const allowlist = databaseAllowlist
    .split(",")
    .map((value) => value.trim())
    .map(databaseAllowlistKey)
    .filter(Boolean);
  assert(
    allowlist.includes(databaseSafetyKey(databaseUrl)),
    `${label} is not allowlisted for workspace e2e`
  );
};

const databaseSafetyKey = (databaseUrl: string) => {
  const url = new URL(normalizePostgresConnectionUrl(databaseUrl));
  return databaseKeyFromHostPath(url.hostname, url.pathname);
};

const databaseAllowlistKey = (value: string) => {
  if (!value) return value;
  if (value.includes("://")) return databaseSafetyKey(value);
  const slashIndex = value.indexOf("/");
  if (slashIndex === -1) return databaseKeyFromHostPath(value, "");
  return databaseKeyFromHostPath(
    value.slice(0, slashIndex),
    value.slice(slashIndex)
  );
};

const databaseKeyFromHostPath = (hostname: string, pathname: string) => {
  const [firstLabel, ...rest] = hostname.split(".");
  const normalizedFirstLabel =
    hostname.endsWith(".neon.tech") && firstLabel?.endsWith("-pooler")
      ? firstLabel.slice(0, -"-pooler".length)
      : firstLabel;
  return `${[normalizedFirstLabel, ...rest].join(".")}${pathname}`;
};

export const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export const log = (message: string) =>
  process.stdout.write(`${redact(message)}\n`);

export const writeJsonAtomically = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
};
