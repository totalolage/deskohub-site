import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { browserDiagnosticsScript } from "./browser-scripts";
import type { WorkspaceE2EConfig } from "./config";
import type { Runner } from "./runtime";
import { log, poll, redact } from "./runtime";

export const readBrowserUrl = async (run: Runner, session: string) => {
  const result = await run(
    "agent-browser",
    ["--session", session, "get", "url"],
    { allowFailure: true, logOutput: false }
  );
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
};

export const getBrowserHeaderArgs = (config: WorkspaceE2EConfig) =>
  config.bypassSecret
    ? [
        "--headers",
        JSON.stringify({
          "x-vercel-protection-bypass": config.bypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        }),
      ]
    : [];

export const openBrowserPage = async (
  config: WorkspaceE2EConfig,
  run: Runner,
  session: string,
  url: string,
  options: { readonly timeoutMs?: number } = {}
) =>
  run(
    "agent-browser",
    ["--session", session, ...getBrowserHeaderArgs(config), "open", url],
    { timeoutMs: options.timeoutMs ?? 60_000 }
  );

export const readInteractiveSnapshot = async (
  run: Runner,
  session: string,
  allowFailure = false
) => {
  const result = await run(
    "agent-browser",
    ["--session", session, "snapshot", "-i"],
    { allowFailure, logOutput: false, timeoutMs: 60_000 }
  );
  if (result.exitCode !== 0) return "";
  return result.stdout;
};

export const waitForInteractiveSnapshot = async ({
  description,
  matches,
  run,
  session,
  timeoutMs,
}: {
  description: string;
  matches: (snapshot: string) => boolean;
  run: Runner;
  session: string;
  timeoutMs: number;
}) =>
  poll(
    async () => {
      const snapshot = await readInteractiveSnapshot(run, session, true);
      return matches(snapshot) ? snapshot : undefined;
    },
    timeoutMs,
    description
  );

export const startBrowserDiagnostics = async (run: Runner, session: string) => {
  const commands = [
    ["console", "--clear"],
    ["errors", "--clear"],
    ["network", "requests", "--clear"],
  ];

  for (const args of commands)
    await run("agent-browser", ["--session", session, ...args], {
      allowFailure: true,
      logOutput: false,
      timeoutMs: 30_000,
    });

  const result = await run(
    "agent-browser",
    ["--session", session, "network", "har", "start"],
    { allowFailure: true, logOutput: false, timeoutMs: 30_000 }
  );

  if (result.exitCode !== 0) {
    log("Browser HAR capture unavailable; continuing checkout e2e");
    return false;
  }

  return true;
};

export const captureBrowserFailureArtifacts = async ({
  artifactDir,
  cause,
  harStarted,
  run,
  session,
}: {
  artifactDir: string;
  cause: unknown;
  harStarted: boolean;
  run: Runner;
  session: string;
}) => {
  let harStopped = false;

  try {
    await mkdir(artifactDir, { recursive: true });
    await writeTextArtifact(
      artifactDir,
      "error.txt",
      cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
    );
    await writeTextArtifact(
      artifactDir,
      "browser-diagnostics.txt",
      await readBrowserDiagnostics(run, session)
    );
    await writeCommandArtifact(artifactDir, "network-requests.txt", run, [
      "--session",
      session,
      "network",
      "requests",
    ]);
    await writeCommandArtifact(artifactDir, "console.txt", run, [
      "--session",
      session,
      "console",
    ]);
    await writeCommandArtifact(artifactDir, "errors.txt", run, [
      "--session",
      session,
      "errors",
    ]);
    await writeTextArtifact(
      artifactDir,
      "snapshot-interactive.txt",
      await readInteractiveSnapshot(run, session, true)
    );
    if (harStarted) {
      const rawHarPath = resolve(tmpdir(), `${session}-network.har`);
      harStopped = await stopBrowserHar(run, session, rawHarPath);
      try {
        if (harStopped)
          await writeTextArtifact(
            artifactDir,
            "network.har",
            sanitizeHarArtifact(await readFile(rawHarPath, "utf8"))
          );
      } finally {
        await rm(rawHarPath, { force: true });
      }
    }

    log(`Checkout e2e failure artifacts saved to ${artifactDir}`);
  } catch (error) {
    log(
      `Checkout e2e failure artifact capture failed: ${redact(String(error))}`
    );
  }

  return harStopped;
};

export const stopBrowserHar = async (
  run: Runner,
  session: string,
  path?: string
) => {
  const result = await run(
    "agent-browser",
    ["--session", session, "network", "har", "stop", ...(path ? [path] : [])],
    { allowFailure: true, logOutput: false, timeoutMs: 60_000 }
  );

  return result.exitCode === 0;
};

const writeCommandArtifact = async (
  artifactDir: string,
  fileName: string,
  run: Runner,
  args: string[]
) => {
  const result = await run("agent-browser", args, {
    allowFailure: true,
    logOutput: false,
    timeoutMs: 60_000,
  });
  const text = [
    `exitCode: ${result.exitCode}`,
    result.stdout ? `stdout:\n${result.stdout}` : undefined,
    result.stderr ? `stderr:\n${result.stderr}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");

  await writeTextArtifact(artifactDir, fileName, text);
};

const writeTextArtifact = async (
  artifactDir: string,
  fileName: string,
  text: string
) =>
  writeFile(
    resolve(artifactDir, fileName),
    `${sanitizeArtifactText(text.trim())}\n`
  );

export const switchToMainFrame = async (run: Runner, session: string) => {
  await run("agent-browser", ["--session", session, "frame", "main"], {
    allowFailure: true,
    logOutput: false,
    timeoutMs: 30_000,
  });
};

export const findFirstTextFieldRef = (snapshot: string) => {
  for (const line of snapshot.split("\n")) {
    const ref = getSnapshotRef(line);
    if (ref && /\b(textbox|input)\b/i.test(line)) return ref;
  }
};

export const summarizeHostedPaymentSnapshot = (snapshot: string) => {
  const lines = snapshot
    .split("\n")
    .filter((line) =>
      /\b(?:button|frame|iframe|input|textbox|link)\b/i.test(line)
    )
    .slice(0, 80)
    .map(sanitizeDiagnosticLine)
    .join("\n");

  return lines
    ? `Nexi HPP snapshot summary:\n${lines}`
    : "Nexi HPP snapshot summary unavailable";
};

const sanitizeDiagnosticLine = (line: string) =>
  redact(line)
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[token]");

const sanitizeArtifactText = (text: string) =>
  sanitizeArtifactUrlText(redact(text))
    .replace(/([?&][^=&#\s]+)=[^&\s",}]+/g, "$1=[redacted]")
    .replace(/((?:%3F|%26)[^=%&\s]+)(?:%3D|=)[^%&\s",}]+/gi, "$1%3D[redacted]")
    .replace(/(x-vercel-protection-bypass[=":\s]+)[^&\s",}]+/gi, "$1[redacted]")
    .replace(/[A-Za-z0-9_-]{96,}/g, "[token]");

const sanitizeArtifactUrlText = (text: string) =>
  text.replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
    try {
      const url = new URL(value);
      for (const key of url.searchParams.keys())
        url.searchParams.set(key, "[redacted]");
      return url.toString();
    } catch {
      return value;
    }
  });

const sanitizeHarArtifact = (text: string) => {
  try {
    const har = JSON.parse(text) as Record<string, unknown>;
    const log = asRecord(har.log);
    const entries = Array.isArray(log?.entries) ? log.entries : [];

    for (const entry of entries) {
      const record = asRecord(entry);
      if (!record) continue;
      sanitizeHarRequest(asRecord(record.request));
      sanitizeHarResponse(asRecord(record.response));
    }

    return JSON.stringify(har, null, 2);
  } catch {
    return sanitizeArtifactText(text);
  }
};

const sanitizeHarRequest = (request: Record<string, unknown> | undefined) => {
  if (!request) return;
  if (typeof request.url === "string")
    request.url = sanitizeHarUrl(request.url);
  request.headers = sanitizeHarNamedValues(request.headers);
  request.cookies = [];
  request.queryString = sanitizeHarNamedValues(request.queryString);

  const postData = asRecord(request.postData);
  if (!postData) return;
  postData.params = [];
  if (typeof postData.text === "string") postData.text = "[redacted]";
};

const sanitizeHarResponse = (response: Record<string, unknown> | undefined) => {
  if (!response) return;
  response.headers = sanitizeHarNamedValues(response.headers);
  response.cookies = [];

  const content = asRecord(response.content);
  if (content && typeof content.text === "string") content.text = "[redacted]";
};

const sanitizeHarNamedValues = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => {
        const record = asRecord(item);
        return record ? { ...record, value: "[redacted]" } : item;
      })
    : value;

const sanitizeHarUrl = (value: string) => {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys())
      url.searchParams.set(key, "[redacted]");
    return sanitizeArtifactText(url.toString());
  } catch {
    return sanitizeArtifactText(value);
  }
};

const asRecord = (value: unknown) =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

export const findSnapshotRef = (
  snapshot: string,
  labels: readonly string[]
) => {
  for (const line of snapshot.split("\n")) {
    const ref = getSnapshotRef(line);
    if (!ref) continue;

    const name = line
      .match(/"([^"]+)"/)?.[1]
      ?.trim()
      .toLowerCase();
    if (name && labels.some((label) => name === label.toLowerCase()))
      return ref;
  }

  for (const line of snapshot.split("\n")) {
    const ref = getSnapshotRef(line);
    if (!ref) continue;

    const lowerLine = line.toLowerCase();
    if (labels.some((label) => lowerLine.includes(label.toLowerCase())))
      return ref;
  }
};

export const findEnabledSnapshotRef = (
  snapshot: string,
  labels: readonly string[]
) => {
  for (const line of snapshot.split("\n")) {
    if (/\[disabled\]/i.test(line)) continue;
    const ref = getSnapshotRef(line);
    if (!ref) continue;

    const name = line
      .match(/"([^"]+)"/)?.[1]
      ?.trim()
      .toLowerCase();
    if (name && labels.some((label) => name === label.toLowerCase()))
      return ref;
  }

  for (const line of snapshot.split("\n")) {
    if (/\[disabled\]/i.test(line)) continue;
    const ref = getSnapshotRef(line);
    if (!ref) continue;

    const lowerLine = line.toLowerCase();
    if (labels.some((label) => lowerLine.includes(label.toLowerCase())))
      return ref;
  }
};

export const requireSnapshotRef = async ({
  description,
  labels,
  run,
  session,
  timeoutMs = 60_000,
}: {
  description: string;
  labels: readonly string[];
  run: Runner;
  session: string;
  timeoutMs?: number;
}) => {
  try {
    return await poll(
      async () =>
        findSnapshotRef(await readInteractiveSnapshot(run, session), labels),
      timeoutMs,
      description
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const snapshot = await readInteractiveSnapshot(run, session, true);
    throw new Error(`${message}\n${snapshot}`);
  }
};

export const requireEnabledSnapshotRef = async ({
  description,
  labels,
  run,
  session,
  timeoutMs = 60_000,
}: {
  description: string;
  labels: readonly string[];
  run: Runner;
  session: string;
  timeoutMs?: number;
}) => {
  try {
    return await poll(
      async () =>
        findEnabledSnapshotRef(
          await readInteractiveSnapshot(run, session),
          labels
        ),
      timeoutMs,
      description
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const snapshot = await readInteractiveSnapshot(run, session, true);
    throw new Error(`${message}\n${snapshot}`);
  }
};

export const getSnapshotRef = (line: string) =>
  line.match(/\[ref=(e\d+)\]/)?.[1]?.replace(/^/, "@") ??
  line.match(/@e\d+/)?.[0];

export const waitForBrowserUrl = async ({
  description,
  matches,
  run,
  session,
  timeoutMs,
}: {
  description: string;
  matches: (url: string) => boolean;
  run: Runner;
  session: string;
  timeoutMs: number;
}) => {
  try {
    const url = await poll(
      async () => {
        const result = await run(
          "agent-browser",
          ["--session", session, "get", "url"],
          { allowFailure: true, logOutput: false }
        );
        const url = result.stdout.trim();
        return result.exitCode === 0 && matches(url) ? url : undefined;
      },
      timeoutMs,
      description
    );
    log(`Reached ${description}`);
    return url;
  } catch (error) {
    const diagnostics = await readBrowserDiagnostics(run, session);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n${diagnostics}`);
  }
};

const readBrowserDiagnostics = async (run: Runner, session: string) => {
  const result = await run(
    "agent-browser",
    ["--session", session, "eval", "--stdin"],
    {
      allowFailure: true,
      input: browserDiagnosticsScript,
      logOutput: false,
    }
  );

  if (result.exitCode !== 0) return "Browser diagnostics unavailable";
  return `Browser diagnostics:\n${result.stdout}`;
};
