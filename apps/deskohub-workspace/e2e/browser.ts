import { Effect } from "effect";
import { browserDiagnosticsScript, browserTextScript } from "./browser-scripts";
import { type E2EBrowserSession, isPlaywrightTimeout } from "./browser-session";
import type { WorkspaceE2EConfig } from "./config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2ETimeoutError,
} from "./errors";
import { pollUntil } from "./polling";
import type { Runner } from "./runtime";
import { log, redactDiagnosticText } from "./runtime";
import { workspaceE2EPollIntervalMs } from "./timeouts";

// Playwright reports an exhausted command budget as its TimeoutError; classify
// it as a Workspace E2E timeout so pollers can retry it like their own deadlines.
export const runBrowserCommand = (
  operation: string,
  run: Runner,
  session: string,
  args: string[],
  options?: Parameters<Runner>[2]
) =>
  tryWorkspaceE2EPromise(operation, (signal) =>
    run("playwright", ["--session", session, ...args], {
      ...options,
      signal,
    })
  ).pipe(
    Effect.mapError((error) =>
      isPlaywrightTimeout(error.cause)
        ? workspaceE2ETimeoutError(error.message, {
            cause: error.cause,
            operation: error.operation,
          })
        : error
    )
  );

// The session's request/response log, or an empty log when it is unavailable.
export const readBrowserNetworkLog = (
  run: Runner,
  session: string
): Effect.Effect<string, WorkspaceE2EError> =>
  runBrowserCommand(
    "read browser network log",
    run,
    session,
    ["network", "requests"],
    {
      allowFailure: true,
      logCommand: false,
      logOutput: false,
      timeoutMs: 30_000,
    }
  ).pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout : "")));

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

export const readActiveBrowserTabId = (
  run: Runner,
  session: string
): Effect.Effect<string, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const tabs = yield* readBrowserTabs(run, session);
    const tabId = tabs.find((tab) => tab.active)?.tabId;
    if (!tabId) {
      return yield* toWorkspaceE2EError(
        "read active browser tab",
        new Error("active browser tab missing")
      );
    }
    return tabId;
  });

export type BrowserTab = {
  readonly active: boolean;
  readonly tabId: string;
};

export const readBrowserTabs = (
  run: Runner,
  session: string
): Effect.Effect<readonly BrowserTab[], WorkspaceE2EError> =>
  Effect.gen(function* () {
    const result = yield* runBrowserCommand(
      "read browser tabs",
      run,
      session,
      ["--json", "tab", "list"],
      { logOutput: false }
    );
    return yield* tryWorkspaceE2ESync("parse browser tabs", () => {
      const response = JSON.parse(result.stdout) as {
        readonly data?: {
          readonly tabs?: readonly {
            readonly active?: boolean;
            readonly tabId?: string;
          }[];
        };
      };
      return (response.data?.tabs ?? []).map((tab) => {
        if (!tab.tabId) throw new Error("browser tab id missing");
        return { active: tab.active === true, tabId: tab.tabId };
      });
    });
  });

export const switchToBrowserTab = (
  run: Runner,
  session: string,
  tabId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand("switch browser tab", run, session, ["tab", tabId], {
    logOutput: false,
  }).pipe(Effect.asVoid);

export const closeBrowserTab = (
  run: Runner,
  session: string,
  tabId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand(
    "close browser tab",
    run,
    session,
    ["tab", "close", tabId],
    {
      logOutput: false,
    }
  ).pipe(Effect.asVoid);

const getBrowserHeaderArgs = (config: WorkspaceE2EConfig) =>
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

export const waitForBrowserReactHandler = (
  run: Runner,
  session: string,
  selector: string,
  handler: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> => {
  const selectorLiteral = JSON.stringify(selector);
  const handlerLiteral = JSON.stringify(handler);
  const handlerCheck = `(() => {
    const element = document.querySelector(${selectorLiteral});
    const reactPropsKey = element === null
      ? undefined
      : Object.keys(element).find((key) => key.startsWith("__reactProps$"));
    const reactProps = reactPropsKey === undefined ? undefined : element[reactPropsKey];
    return typeof reactProps?.[${handlerLiteral}] === "function";
  })()`;

  return runBrowserCommand(
    `wait for browser React ${handler} handler`,
    run,
    session,
    ["wait", "--fn", handlerCheck],
    {
      logOutput: false,
      timeoutMs: options.timeoutMs ?? 60_000,
    }
  ).pipe(Effect.asVoid);
};

export const waitForBrowserCondition = (
  run: Runner,
  session: string,
  description: string,
  condition: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand(
    `wait for ${description}`,
    run,
    session,
    ["wait", "--fn", condition],
    {
      logOutput: false,
      timeoutMs: options.timeoutMs ?? 60_000,
    }
  ).pipe(Effect.asVoid);

export const waitForBrowserTextContent = (
  run: Runner,
  session: string,
  text: string,
  options: {
    readonly caseSensitive?: boolean;
    readonly timeoutMs?: number;
  } = {}
): Effect.Effect<void, WorkspaceE2EError> => {
  const caseSensitive = options.caseSensitive !== false;
  const textLiteral = JSON.stringify(
    caseSensitive ? text : text.toLocaleLowerCase()
  );
  const bodyText = caseSensitive
    ? "document.body?.innerText"
    : "document.body?.innerText.toLocaleLowerCase()";
  const textCheck = `(() => ${bodyText}.includes(${textLiteral}) ?? false)()`;

  return runBrowserCommand(
    "wait for browser text content",
    run,
    session,
    ["wait", "--fn", textCheck],
    {
      logOutput: false,
      timeoutMs: options.timeoutMs ?? 60_000,
    }
  ).pipe(Effect.asVoid);
};

export const waitForBrowserReactFormSubmit = (
  run: Runner,
  session: string,
  selector: string,
  visibleFieldSelectors: readonly string[],
  options: {
    readonly requiredReadyAttribute?: {
      readonly name: string;
      readonly value: string;
    };
    readonly timeoutMs?: number;
  } = {}
): Effect.Effect<void, WorkspaceE2EError> => {
  const selectorLiteral = JSON.stringify(selector);
  const fieldSelectorsLiteral = JSON.stringify(visibleFieldSelectors);
  const requiredReadyAttribute = options.requiredReadyAttribute;
  const readyAttributeCheck =
    requiredReadyAttribute === undefined
      ? "true"
      : `form.getAttribute(${JSON.stringify(requiredReadyAttribute.name)}) === ${JSON.stringify(requiredReadyAttribute.value)}`;
  const handlersCheck = `(() => {
    const form = document.querySelector(${selectorLiteral});
    const reactPropsKey = form === null
      ? undefined
      : Object.keys(form).find((key) => key.startsWith("__reactProps$"));
    const reactProps = reactPropsKey === undefined ? undefined : form[reactPropsKey];
    const formHasSubmitHandler = typeof reactProps?.onSubmit === "function";
    if (!formHasSubmitHandler) return false;
    if (!(${readyAttributeCheck})) return false;
    const fieldSelectors = ${fieldSelectorsLiteral};
    if (fieldSelectors.length === 0) return false;
    return fieldSelectors.every((fieldSelector) => {
      const field = document.querySelector(fieldSelector);
      if (field === null || !form.contains(field)) return false;
      if (field instanceof HTMLInputElement && field.type === "hidden") return true;
      const fieldStyle = window.getComputedStyle(field);
      const fieldIsVisible =
        field.getClientRects().length > 0 &&
        fieldStyle.display !== "none" &&
        fieldStyle.visibility === "visible";
      if (!fieldIsVisible) return false;
      const fieldPropsKey = Object.keys(field).find((key) =>
        key.startsWith("__reactProps$")
      );
      const fieldProps =
        fieldPropsKey === undefined ? undefined : field[fieldPropsKey];
      return typeof fieldProps?.onChange === "function";
    });
  })()`;

  return runBrowserCommand(
    "wait for browser React form handlers",
    run,
    session,
    ["wait", "--fn", handlersCheck],
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

export const clickBrowserElement = (
  run: Runner,
  session: string,
  selector: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand(
    "click browser element",
    run,
    session,
    ["click", selector],
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

export const scrollBrowserElementIntoView = (
  run: Runner,
  session: string,
  selector: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> => {
  const selectorLiteral = JSON.stringify(selector);
  return runBrowserCommand(
    "scroll browser element into view",
    run,
    session,
    ["eval", "--stdin"],
    {
      input: `
(async () => {
  const element = document.querySelector(${selectorLiteral});
  if (!(element instanceof HTMLElement)) {
    throw new Error('scroll target not found');
  }
  element.scrollIntoView({
    behavior: "instant",
    block: "center",
    inline: "nearest",
  });
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
})()
`,
      logOutput: false,
      timeoutMs: options.timeoutMs ?? 60_000,
    }
  ).pipe(Effect.asVoid);
};

export const captureBrowserScreenshot = (
  run: Runner,
  session: string,
  path: string,
  options: { readonly timeoutMs: number }
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand(
    "capture browser screenshot",
    run,
    session,
    ["screenshot", path],
    {
      logOutput: false,
      timeoutMs: options.timeoutMs,
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

export const activateBrowserElement = (
  run: Runner,
  session: string,
  selector: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* focusBrowserElement(run, session, selector, options);
    yield* pressBrowserKey(run, session, "Enter", options);
  });

export const activateHydratedBrowserElement = (
  run: Runner,
  session: string,
  selector: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* waitForBrowserReactHydration(run, session, selector, options);
    yield* activateBrowserElement(run, session, selector, options);
  });

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
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: description,
      timeoutMs,
    }
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

export const normalizeBrowserText = (text: string) =>
  text.replaceAll(/\s+/g, " ").trim();

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
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: description,
      timeoutMs,
    }
  );

// Best-effort switch for cleanup and diagnostics; a failed switch is ignored.
export const switchToMainFrame = (
  run: Runner,
  session: string
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand("switch to main frame", run, session, ["frame", "main"], {
    allowFailure: true,
    logOutput: false,
    timeoutMs: 30_000,
  }).pipe(Effect.asVoid);

// Fails unless the session is back in the main frame, for callers whose next
// commands must not run inside an iframe.
export const requireMainFrame = (
  run: Runner,
  session: string
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand("switch to main frame", run, session, ["frame", "main"], {
    logOutput: false,
    timeoutMs: 30_000,
  }).pipe(
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.void
        : Effect.fail(
            toWorkspaceE2EError(
              "switch to main frame",
              new Error(`frame command exited with ${result.exitCode}`)
            )
          )
    )
  );

export const closeBrowserSession = (
  run: Runner,
  session: string
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand("close browser session", run, session, ["close"], {
    allowFailure: true,
    logOutput: false,
  }).pipe(Effect.asVoid);

export const summarizeHostedPaymentSnapshot = (snapshot: string) => {
  const lines = snapshot
    .split("\n")
    .filter((line) =>
      /\b(?:button|frame|heading|iframe|input|textbox|link)\b/i.test(line)
    )
    .slice(0, 80)
    .map(redactDiagnosticText)
    .join("\n");

  return lines
    ? `Nexi HPP snapshot summary:\n${lines}`
    : "Nexi HPP snapshot summary unavailable";
};

const findSnapshotRef = (
  snapshot: string,
  labels: readonly string[],
  role?: string
) => {
  for (const line of snapshot.split("\n")) {
    if (!hasSnapshotRole(line, role)) continue;
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
    if (!hasSnapshotRole(line, role)) continue;
    const ref = getSnapshotRef(line);
    if (!ref) continue;

    const lowerLine = line.toLowerCase();
    if (labels.some((label) => lowerLine.includes(label.toLowerCase())))
      return ref;
  }
};

const hasSnapshotRole = (line: string, role: string | undefined) =>
  role === undefined ||
  line.match(/^\s*-\s+(\S+)/)?.[1]?.toLowerCase() === role.toLowerCase();

export const findEnabledSnapshotRef = (
  snapshot: string,
  labels: readonly string[],
  role?: string
) => {
  for (const line of snapshot.split("\n")) {
    if (!hasSnapshotRole(line, role)) continue;
    if (hasDisabledSnapshotState(line)) continue;
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
    if (!hasSnapshotRole(line, role)) continue;
    if (hasDisabledSnapshotState(line)) continue;
    const ref = getSnapshotRef(line);
    if (!ref) continue;

    const lowerLine = line.toLowerCase();
    if (labels.some((label) => lowerLine.includes(label.toLowerCase())))
      return ref;
  }
};

const hasDisabledSnapshotState = (line: string) =>
  /\[[^\]]*\bdisabled\b[^\]]*\]/i.test(line);

export const requireSnapshotRef = ({
  description,
  labels,
  role,
  run,
  session,
  timeoutMs = 60_000,
}: {
  description: string;
  labels: readonly string[];
  role?: string;
  run: Runner;
  session: string;
  timeoutMs?: number;
}): Effect.Effect<string, WorkspaceE2EError> =>
  pollUntil(
    readInteractiveSnapshot(run, session).pipe(
      Effect.map((snapshot) => findSnapshotRef(snapshot, labels, role))
    ),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: description,
      timeoutMs,
    }
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
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: description,
      timeoutMs,
    }
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
  line.match(/\bref=((?:f\d+)?e\d+)\b/)?.[1]?.replace(/^/, "@") ??
  line.match(/@(?:f\d+)?e\d+/)?.[0];

export const isFrameSnapshotRef = (ref: string) => /^@f\d+e\d+$/.test(ref);

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
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: description,
      timeoutMs,
    }
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
        ? formatBrowserDiagnostics(result.stdout)
        : unavailableBrowserDiagnostics
    )
  );

/**
 * The checkout page summary for a failure artifact: URL, title, alerts, and
 * the reservation action's state. It has no deadline of its own; the caller
 * bounds it.
 */
export const readBrowserPageDiagnostics = (
  session: E2EBrowserSession
): Effect.Effect<string> =>
  session
    .use("read browser diagnostics", (page) =>
      page.evaluate(browserDiagnosticsScript)
    )
    .pipe(
      Effect.map((summary) =>
        formatBrowserDiagnostics(JSON.stringify(summary))
      ),
      Effect.orElseSucceed(() => unavailableBrowserDiagnostics)
    );

const formatBrowserDiagnostics = (summary: string) =>
  `Browser diagnostics:\n${summary}`;

const unavailableBrowserDiagnostics = "Browser diagnostics unavailable";
