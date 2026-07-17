import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { normalizePostgresConnectionUrl } from "../db/postgres-connection-url";

export const scriptDir = dirname(fileURLToPath(import.meta.url));
export const workspaceDir = resolve(scriptDir, "..");
export const repoRoot = resolve(workspaceDir, "../..");
const redactions = new Set<string>();

export const makeRunner =
  (config: {
    readonly vercelProjectId: string;
    readonly vercelTeamId: string;
  }) =>
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
    const printable = redact([command, ...args].join(" "));
    if (options.logCommand !== false) log(`$ ${printable}`);

    const child = Bun.spawn([command, ...args], {
      cwd: options.cwd,
      env: {
        ...baseChildEnv(),
        VERCEL_ORG_ID: config.vercelTeamId,
        VERCEL_PROJECT_ID: config.vercelProjectId,
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

const baseChildEnv = () =>
  Object.fromEntries(
    ["CI", "HOME", "LANG", "PATH", "TMPDIR", "USER"].flatMap((key) => {
      const value = process.env[key];
      return value ? [[key, value]] : [];
    })
  );

export type Runner = ReturnType<typeof makeRunner>;

export const assertSafeDatabaseUrl = (databaseUrl: string, label: string) => {
  const allowlist = requireEnv("WORKSPACE_E2E_DATABASE_ALLOWLIST")
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

export const extractDeploymentUrl = (stdout: string) => {
  const urls = stdout.match(/https:\/\/[^\s]+\.vercel\.app/g) ?? [];
  const url = urls.at(-1);
  assert(url, "could not find Vercel preview URL in deploy output");
  return url;
};

export const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

export const loadEnvFile = (path: string) =>
  Effect.gen(function* () {
    const values = new Map<string, string>();
    const text = yield* Effect.promise(() =>
      readFile(path, "utf8").catch(() => undefined)
    );
    if (text === undefined) return values;

    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equals = trimmed.indexOf("=");
      if (equals === -1) continue;
      const key = trimmed.slice(0, equals).trim();
      const value = unquoteEnv(trimmed.slice(equals + 1).trim());
      values.set(key, value);
      if (!env(key)) process.env[key] = value;
    }

    return values;
  });

const unquoteEnv = (value: string) => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replaceAll("\\n", "\n");
  }
  return value;
};

export const requireEnv = (name: string) => {
  const value = env(name);
  assert(value, `${name} is required for workspace e2e`);
  addRedaction(value);
  return value;
};

export const env = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

export const addRedaction = (value: string | undefined, force = false) => {
  if (!value || (!force && value.length <= 6)) return;
  redactions.add(value);
  redactions.add(encodeURIComponent(value));
  redactions.add(
    new URLSearchParams({ value }).toString().slice("value=".length)
  );
};

export const redact = (text: string) => {
  let output = text;
  for (const secret of redactions)
    output = output.replaceAll(secret, "[redacted]");
  return output;
};

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export const log = (message: string) =>
  process.stdout.write(`${redact(message)}\n`);
