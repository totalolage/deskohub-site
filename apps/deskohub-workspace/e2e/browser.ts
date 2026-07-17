import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Effect } from "effect";
import { browserDiagnosticsScript, browserTextScript } from "./browser-scripts";
import type { WorkspaceE2EConfig } from "./config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2EPromise,
  type WorkspaceE2EError,
} from "./errors";
import { pollUntil } from "./polling";
import type { Runner } from "./runtime";
import { log, redact } from "./runtime";

const runBrowserCommand = (
  operation: string,
  run: Runner,
  session: string,
  args: string[],
  options?: Parameters<Runner>[2]
) =>
  tryWorkspaceE2EPromise(operation, () =>
    run("agent-browser", ["--session", session, ...args], options)
  );

export const readBrowserUrl = (
  run: Runner,
  session: string
): Effect.Effect<string | undefined, WorkspaceE2EError> =>
  runBrowserCommand("read browser URL", run, session, ["get", "url"], {
    allowFailure: true,
    logOutput: false,
  }).pipe(
    Effect.map((result) =>
      result.exitCode === 0 ? result.stdout.trim() : undefined
    )
  );

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

export const openBrowserPage = (
  config: WorkspaceE2EConfig,
  run: Runner,
  session: string,
  url: string,
  options: { readonly timeoutMs?: number } = {}
) =>
  runBrowserCommand(
    "open browser page",
    run,
    session,
    [...getBrowserHeaderArgs(config), "open", url],
    { timeoutMs: options.timeoutMs ?? 60_000 }
  );

export const waitForBrowserReactHydration = (
  run: Runner,
  session: string,
  selector: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> => {
  const selectorLiteral = JSON.stringify(selector);
  const hydrationCheck = `(() => {
    const element = document.querySelector(${selectorLiteral});
    return element !== null && Object.keys(element).some((key) => key.startsWith("__reactProps$"));
  })()`;

  return runBrowserCommand(
    "wait for browser React hydration",
    run,
    session,
    ["wait", "--fn", hydrationCheck],
    {
      logOutput: false,
      timeoutMs: options.timeoutMs ?? 60_000,
    }
  ).pipe(Effect.asVoid);
};

export const evalBrowserScript = (
  operation: string,
  run: Runner,
  session: string,
  input: string,
  options: Omit<NonNullable<Parameters<Runner>[2]>, "input"> = {}
) =>
  runBrowserCommand(operation, run, session, ["eval", "--stdin"], {
    input,
    ...options,
  });

export const fillBrowserField = (
  run: Runner,
  session: string,
  selector: string,
  value: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand(
    "fill browser field",
    run,
    session,
    ["fill", selector, value],
    {
      logOutput: false,
      timeoutMs: options.timeoutMs ?? 60_000,
    }
  ).pipe(Effect.asVoid);

export const focusBrowserElement = (
  run: Runner,
  session: string,
  selector: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand(
    "focus browser element",
    run,
    session,
    ["focus", selector],
    {
      logOutput: false,
      timeoutMs: options.timeoutMs ?? 60_000,
    }
  ).pipe(Effect.asVoid);

export const pressBrowserKey = (
  run: Runner,
  session: string,
  key: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand("press browser key", run, session, ["press", key], {
    logOutput: false,
    timeoutMs: options.timeoutMs ?? 60_000,
  }).pipe(Effect.asVoid);

export const readInteractiveSnapshot = (
  run: Runner,
  session: string,
  allowFailure = false
): Effect.Effect<string, WorkspaceE2EError> =>
  runBrowserCommand(
    "read interactive browser snapshot",
    run,
    session,
    ["snapshot", "-i"],
    { allowFailure, logOutput: false, timeoutMs: 60_000 }
  ).pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout : "")));

export const waitForInteractiveSnapshot = ({
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
  pollUntil(
    readInteractiveSnapshot(run, session, true).pipe(
      Effect.map((snapshot) => (matches(snapshot) ? snapshot : undefined))
    ),
    timeoutMs,
    description
  );

export const readBrowserText = (
  run: Runner,
  session: string,
  allowFailure = false
): Effect.Effect<string, WorkspaceE2EError> =>
  runBrowserCommand("read browser text", run, session, ["eval", "--stdin"], {
    allowFailure,
    input: browserTextScript,
    logOutput: false,
    timeoutMs: 30_000,
  }).pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout : "")));

export const waitForBrowserText = ({
  description,
  matches,
  run,
  session,
  timeoutMs,
}: {
  description: string;
  matches: (text: string) => boolean;
  run: Runner;
  session: string;
  timeoutMs: number;
}) =>
  pollUntil(
    readBrowserText(run, session, true).pipe(
      Effect.map((text) => (matches(text) ? text : undefined))
    ),
    timeoutMs,
    description
  );

export const startBrowserDiagnostics = (
  run: Runner,
  session: string
): Effect.Effect<boolean, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const commands = [
      ["console", "--clear"],
      ["errors", "--clear"],
      ["network", "requests", "--clear"],
    ];

    yield* Effect.forEach(commands, (args) =>
      runBrowserCommand(`clear browser ${args.join(" ")}`, run, session, args, {
        allowFailure: true,
        logOutput: false,
        timeoutMs: 30_000,
      })
    );

    const result = yield* runBrowserCommand(
      "start browser HAR",
      run,
      session,
      ["network", "har", "start"],
      { allowFailure: true, logOutput: false, timeoutMs: 30_000 }
    );

    if (result.exitCode !== 0) {
      log("Browser HAR capture unavailable; continuing checkout e2e");
      return false;
    }

    return true;
  });

export const captureBrowserFailureArtifacts = ({
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
}): Effect.Effect<boolean, WorkspaceE2EError> =>
  Effect.gen(function* () {
    let harStopped = false;

    yield* tryWorkspaceE2EPromise("create browser artifact directory", () =>
      mkdir(artifactDir, { recursive: true })
    );
    yield* writeTextArtifact(
      artifactDir,
      "error.txt",
      cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)
    );
    yield* writeTextArtifact(
      artifactDir,
      "browser-diagnostics.txt",
      yield* readBrowserDiagnostics(run, session)
    );
    yield* writeCommandArtifact(artifactDir, "network-requests.txt", run, [
      "--session",
      session,
      "network",
      "requests",
    ]);
    yield* writeCommandArtifact(artifactDir, "console.txt", run, [
      "--session",
      session,
      "console",
    ]);
    yield* writeCommandArtifact(artifactDir, "errors.txt", run, [
      "--session",
      session,
      "errors",
    ]);
    yield* writeTextArtifact(
      artifactDir,
      "snapshot-interactive.txt",
      yield* readInteractiveSnapshot(run, session, true)
    );

    if (harStarted) {
      const rawHarPath = resolve(tmpdir(), `${session}-network.har`);
      harStopped = yield* stopBrowserHar(run, session, rawHarPath);
      yield* Effect.gen(function* () {
        if (!harStopped) return;
        const har = yield* tryWorkspaceE2EPromise(
          "read browser HAR artifact",
          () => readFile(rawHarPath, "utf8")
        );
        yield* writeTextArtifact(
          artifactDir,
          "network.har",
          sanitizeHarArtifact(har)
        );
      }).pipe(
        Effect.ensuring(
          tryWorkspaceE2EPromise("remove raw browser HAR artifact", () =>
            rm(rawHarPath, { force: true })
          ).pipe(Effect.ignore)
        )
      );
    }

    log(`Checkout e2e failure artifacts saved to ${artifactDir}`);
    return harStopped;
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        log(
          `Checkout e2e failure artifact capture failed: ${redact(String(error))}`
        );
        return false;
      })
    )
  );

export const stopBrowserHar = (
  run: Runner,
  session: string,
  path?: string
): Effect.Effect<boolean, WorkspaceE2EError> =>
  runBrowserCommand(
    "stop browser HAR",
    run,
    session,
    ["network", "har", "stop", ...(path ? [path] : [])],
    { allowFailure: true, logOutput: false, timeoutMs: 60_000 }
  ).pipe(Effect.map((result) => result.exitCode === 0));

const writeCommandArtifact = (
  artifactDir: string,
  fileName: string,
  run: Runner,
  args: string[]
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const result = yield* tryWorkspaceE2EPromise(
      `write ${fileName} artifact`,
      () =>
        run("agent-browser", args, {
          allowFailure: true,
          logOutput: false,
          timeoutMs: 60_000,
        })
    );
    const text = [
      `exitCode: ${result.exitCode}`,
      result.stdout ? `stdout:\n${result.stdout}` : undefined,
      result.stderr ? `stderr:\n${result.stderr}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");

    yield* writeTextArtifact(artifactDir, fileName, text);
  });

const writeTextArtifact = (
  artifactDir: string,
  fileName: string,
  text: string
): Effect.Effect<void, WorkspaceE2EError> =>
  tryWorkspaceE2EPromise(`write ${fileName} artifact`, () =>
    writeFile(
      resolve(artifactDir, fileName),
      `${sanitizeArtifactText(text.trim())}\n`
    )
  );

export const switchToMainFrame = (
  run: Runner,
  session: string
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand("switch to main frame", run, session, ["frame", "main"], {
    allowFailure: true,
    logOutput: false,
    timeoutMs: 30_000,
  }).pipe(Effect.asVoid);

export const closeBrowserSession = (
  run: Runner,
  session: string
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand("close browser session", run, session, ["close"], {
    allowFailure: true,
    logOutput: false,
  }).pipe(Effect.asVoid);

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

export const requireSnapshotRef = ({
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
}): Effect.Effect<string, WorkspaceE2EError> =>
  pollUntil(
    readInteractiveSnapshot(run, session).pipe(
      Effect.map((snapshot) => findSnapshotRef(snapshot, labels))
    ),
    timeoutMs,
    description
  ).pipe(
    Effect.catch((error) =>
      readInteractiveSnapshot(run, session, true).pipe(
        Effect.flatMap((snapshot) =>
          Effect.fail(
            toWorkspaceE2EError(
              description,
              new Error(`${error.message}\n${snapshot}`)
            )
          )
        )
      )
    )
  );

export const requireEnabledSnapshotRef = ({
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
}): Effect.Effect<string, WorkspaceE2EError> =>
  pollUntil(
    readInteractiveSnapshot(run, session).pipe(
      Effect.map((snapshot) => findEnabledSnapshotRef(snapshot, labels))
    ),
    timeoutMs,
    description
  ).pipe(
    Effect.catch((error) =>
      readInteractiveSnapshot(run, session, true).pipe(
        Effect.flatMap((snapshot) =>
          Effect.fail(
            toWorkspaceE2EError(
              description,
              new Error(`${error.message}\n${snapshot}`)
            )
          )
        )
      )
    )
  );

export const getSnapshotRef = (line: string) =>
  line.match(/\[ref=(e\d+)\]/)?.[1]?.replace(/^/, "@") ??
  line.match(/@e\d+/)?.[0];

export const waitForBrowserUrl = ({
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
}): Effect.Effect<string, WorkspaceE2EError> =>
  pollUntil(
    readBrowserUrl(run, session).pipe(
      Effect.map((url) => (url && matches(url) ? url : undefined))
    ),
    timeoutMs,
    description
  ).pipe(
    Effect.tap(() => Effect.sync(() => log(`Reached ${description}`))),
    Effect.catch((error) =>
      readBrowserDiagnostics(run, session).pipe(
        Effect.flatMap((diagnostics) =>
          Effect.fail(
            toWorkspaceE2EError(
              description,
              new Error(`${error.message}\n${diagnostics}`)
            )
          )
        )
      )
    )
  );

const readBrowserDiagnostics = (
  run: Runner,
  session: string
): Effect.Effect<string, WorkspaceE2EError> =>
  runBrowserCommand(
    "read browser diagnostics",
    run,
    session,
    ["eval", "--stdin"],
    {
      allowFailure: true,
      input: browserDiagnosticsScript,
      logOutput: false,
    }
  ).pipe(
    Effect.map((result) =>
      result.exitCode === 0
        ? `Browser diagnostics:\n${result.stdout}`
        : "Browser diagnostics unavailable"
    )
  );
