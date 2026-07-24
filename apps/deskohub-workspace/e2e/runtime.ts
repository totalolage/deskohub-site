import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePostgresConnectionUrl } from "../db/postgres-connection-url";
import type { E2EEnvironment } from "./e2e-env";

export const scriptDir = dirname(fileURLToPath(import.meta.url));
export const workspaceDir = resolve(scriptDir, "..");
export const repoRoot = resolve(workspaceDir, "../..");
const redactions = new Set<string>();

export const makeRunner =
  (environment: E2EEnvironment) =>
  async (
    command: string,
    args: string[],
    options: {
      allowFailure?: boolean;
      cwd?: string;
      env?: Record<string, string | undefined>;
      input?: string;
      logCommand?: boolean;
      logOutput?: boolean;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {}
  ) => {
    const printable = formatRunnerCommand(command, args);
    if (options.logCommand !== false) log(`$ ${printable}`);

    const child = Bun.spawn([command, ...args], {
      cwd: options.cwd,
      env: {
        ...baseChildEnv(environment),
        ...options.env,
      },
      stderr: "pipe",
      stdin: options.input ? "pipe" : "ignore",
      stdout: "pipe",
      signal: options.signal,
    });

    if (options.input) {
      child.stdin?.write(options.input);
      child.stdin?.end();
    }

    const timeout = setTimeout(
      () => child.kill(),
      options.timeoutMs ?? 120_000
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]).finally(() => clearTimeout(timeout));

    const result = {
      exitCode,
      stderr: redact(stderr.trim()),
      stdout: redact(stdout.trim()),
    };

    if (exitCode !== 0 && !options.allowFailure) {
      throw new Error(
        `${options.logCommand === false ? command : printable} failed with ${exitCode}\n${result.stdout}\n${result.stderr}`.trim()
      );
    }

    if (options.logOutput !== false) {
      if (result.stdout) log(result.stdout);
      if (result.stderr) log(result.stderr);
    }

    return result;
  };

const childEnvironmentKeys = [
  "CI",
  "HOME",
  "LANG",
  "PATH",
  "TMPDIR",
  "USER",
] as const;

const baseChildEnv = (environment: E2EEnvironment) =>
  Object.fromEntries(
    childEnvironmentKeys.flatMap((key) => {
      const value = environment[key];
      return value ? [[key, value]] : [];
    })
  );

export type Runner = ReturnType<typeof makeRunner>;

export const formatRunnerCommand = (command: string, args: readonly string[]) =>
  redact([command, ...args].join(" "));

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

export const addRedaction = (value: string | undefined, force = false) => {
  if (!value || (!force && value.length <= 6)) return;
  redactions.add(value);
  redactions.add(encodeURIComponent(value));
  redactions.add(
    new URLSearchParams({ value }).toString().slice("value=".length)
  );
};

const decodeQueryComponent = (value: string) => {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return value;
  }
};

const decodeQueryKey = (value: string, layers = 2) => {
  let decoded = value;
  for (let layer = 0; layer < layers; layer += 1) {
    const next = decodeQueryComponent(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
};

const redactPayStateQuery = (value: string) =>
  value.replace(
    /([?&])([^?&\s"'<>]*?)(=|%(?:25)*(?:3d))([^&\s"'<>]*)/gi,
    (parameter, delimiter, rawKey, separator) =>
      decodeQueryKey(rawKey).toLowerCase() === "paystate"
        ? `${delimiter}${rawKey}${separator}[redacted]`
        : parameter
  );

const redactEncodedQuery = (value: string, remainingLayers: number): string => {
  const structurallyRedacted = redactPayStateQuery(value);
  if (structurallyRedacted !== value || remainingLayers === 0) {
    return structurallyRedacted;
  }
  if (!/%(?:25)*(?:3f|26)/i.test(value)) return value;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded === value) return value;
    const redacted = redactEncodedQuery(decoded, remainingLayers - 1);
    return redacted === decoded ? value : encodeURIComponent(redacted);
  } catch {
    return value;
  }
};

export const redact = (text: string) => {
  let output = text.replace(/[^\s"'<>]+/g, (candidate) =>
    redactEncodedQuery(candidate, 2)
  );
  for (const secret of redactions)
    output = output.replaceAll(secret, "[redacted]");
  return output;
};

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export const log = (message: string) =>
  process.stdout.write(`${redact(message)}\n`);
