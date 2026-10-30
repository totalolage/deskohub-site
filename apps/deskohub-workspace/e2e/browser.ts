import { Effect } from "effect";
import { browserTextScript, inPageCall } from "./browser-scripts";
import { type E2EBrowserSession, isPlaywrightTimeout } from "./browser-session";
import type { WorkspaceE2EConfig } from "./config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  withoutWorkspaceE2ETimeout,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "./errors";
import { pollUntil } from "./polling";
import { redact } from "./redaction";
import type { Runner } from "./runtime";
import { log, redactDiagnosticText } from "./runtime";
import { argvCommandTimeoutMs, workspaceE2EPollIntervalMs } from "./timeouts";

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
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand(
    "wait for browser React hydration",
    run,
    session,
    ["wait", "--fn", inPageCall(isReactHydrated, { selector })],
    {
      logOutput: false,
      timeoutMs: options.timeoutMs ?? 60_000,
    }
  ).pipe(Effect.asVoid);

export const waitForBrowserReactHandler = (
  run: Runner,
  session: string,
  selector: string,
  handler: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand(
    `wait for browser React ${handler} handler`,
    run,
    session,
    ["wait", "--fn", inPageCall(hasReactHandler, { handler, selector })],
    {
      logOutput: false,
      timeoutMs: options.timeoutMs ?? 60_000,
    }
  ).pipe(Effect.asVoid);

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
): Effect.Effect<void, WorkspaceE2EError> =>
  waitForBrowserCondition(
    run,
    session,
    "browser text content",
    inPageCall(pageTextIncludes, toPageTextQuery(text, options)),
    { timeoutMs: options.timeoutMs }
  );

export const waitForBrowserReactFormSubmit = (
  run: Runner,
  session: string,
  selector: string,
  visibleFieldSelectors: readonly string[],
  options: ReactFormSubmitOptions = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  waitForBrowserCondition(
    run,
    session,
    "browser React form handlers",
    inPageCall(
      isReactFormSubmitReady,
      toReactFormSubmitQuery(selector, visibleFieldSelectors, options)
    ),
    { timeoutMs: options.timeoutMs }
  );

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
): Effect.Effect<void, WorkspaceE2EError> =>
  runBrowserCommand(
    "scroll browser element into view",
    run,
    session,
    ["eval", "--stdin"],
    {
      input: inPageCall(scrollElementIntoView, selector),
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

const readBrowserText = (
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
  pollForUrl(readBrowserUrl(run, session), {
    description,
    matches,
    readDiagnostics: readBrowserDiagnostics(run, session),
    timeoutMs,
  });

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
      input: inPageCall(summarizeCheckoutPage, undefined),
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
 * Polls `readUrl` until `matches` accepts the URL. A wait that fails or runs
 * out fails as a plain error, not a timeout, carrying the page diagnostics.
 */
const pollForUrl = (
  readUrl: Effect.Effect<string | undefined, WorkspaceE2EError>,
  {
    description,
    matches,
    readDiagnostics,
    timeoutMs,
  }: {
    readonly description: string;
    readonly matches: (url: string) => boolean;
    readonly readDiagnostics: Effect.Effect<string, WorkspaceE2EError>;
    readonly timeoutMs: number;
  }
): Effect.Effect<string, WorkspaceE2EError> =>
  pollUntil(
    readUrl.pipe(Effect.map((url) => (url && matches(url) ? url : undefined))),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: description,
      timeoutMs,
    }
  ).pipe(
    Effect.tap(() => Effect.sync(() => log(`Reached ${description}`))),
    Effect.catch((error) =>
      readDiagnostics.pipe(
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

/**
 * Primes preview access for the URL's origin when the run has a bypass
 * secret, then loads the URL in the session's active page. It activates the
 * loaded page again, which drops any iframe the argv runner had selected, as
 * its `open` command did, while argv commands still share the session.
 */
export const openPage = (
  session: E2EBrowserSession,
  config: Pick<WorkspaceE2EConfig, "bypassSecret">,
  url: string,
  { timeoutMs = 60_000 }: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.andThen(
    config.bypassSecret
      ? session.primePreviewAccess(url, config.bypassSecret, { timeoutMs })
      : Effect.void,
    session.use("open browser page", async (page) => {
      await page.goto(url, { timeout: timeoutMs, waitUntil: "load" });
      return page;
    })
  ).pipe(Effect.flatMap(session.activate));

/** Waits until the page's visible text contains `text`. */
export const waitForPageTextContent = (
  session: E2EBrowserSession,
  text: string,
  options: PageTextOptions = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  session
    .use("wait for browser text content", (page) =>
      page.waitForFunction(pageTextIncludes, toPageTextQuery(text, options), {
        timeout: options.timeoutMs ?? 60_000,
      })
    )
    .pipe(Effect.asVoid);

/**
 * The page's visible text with registered secrets redacted, as argv output
 * was. A read that overruns its 30 s bound fails rather than timing out, as
 * the argv `eval` it replaces did.
 */
export const readPageText = (
  session: E2EBrowserSession
): Effect.Effect<string, WorkspaceE2EError> =>
  session
    .evaluate("read browser text", readBodyText, undefined, {
      timeoutMs: 30_000,
    })
    .pipe(withoutWorkspaceE2ETimeout("read browser text"), Effect.map(redact));

/**
 * The session a poller reads, or the runner bridge that resolves it
 * (`browserSessionFor`). A poller resolves a bridge on every read, so a
 * browser that fails to open reads as an unreadable page, as an argv read
 * that allowed failure did.
 */
export type PolledBrowserSession =
  | E2EBrowserSession
  | Effect.Effect<E2EBrowserSession, WorkspaceE2EError>;

const readPolledSession = <A, E>(
  session: PolledBrowserSession,
  read: (session: E2EBrowserSession) => Effect.Effect<A, E>
): Effect.Effect<A, E | WorkspaceE2EError> =>
  Effect.isEffect(session) ? Effect.flatMap(session, read) : read(session);

/**
 * Polls the page's visible text until `matches` accepts it and returns that
 * text with registered secrets redacted. A read that fails or overruns its
 * own bound counts as empty text.
 */
export const waitForPageText = ({
  description,
  matches,
  session,
  timeoutMs,
}: {
  readonly description: string;
  readonly matches: (text: string) => boolean;
  readonly session: PolledBrowserSession;
  readonly timeoutMs: number;
}): Effect.Effect<string, WorkspaceE2EError> =>
  pollUntil(
    readPolledSession(session, readPageText).pipe(
      Effect.orElseSucceed(() => ""),
      Effect.map((text) => (matches(text) ? text : undefined))
    ),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: description,
      timeoutMs,
    }
  );

/**
 * The page body's interactive aria snapshot (`ai` mode) with registered
 * secrets redacted, as the argv `snapshot -i` output was. Each Playwright
 * wait is bounded by that command's 60 s.
 */
const readPageSnapshot = (
  session: E2EBrowserSession
): Effect.Effect<string, WorkspaceE2EError> =>
  session
    .use("read interactive browser snapshot", async (page) => {
      const body = page.locator("body");
      await body.waitFor({ state: "attached", timeout: 60_000 });
      return body.ariaSnapshot({ mode: "ai", timeout: 60_000 });
    })
    .pipe(Effect.map(redact));

/**
 * Polls the interactive aria snapshot until `matches` accepts it and returns
 * it. A read that fails, including a browser that fails to open, counts as
 * an empty snapshot.
 */
export const waitForPageSnapshot = ({
  description,
  matches,
  session,
  timeoutMs,
}: {
  readonly description: string;
  readonly matches: (snapshot: string) => boolean;
  readonly session: PolledBrowserSession;
  readonly timeoutMs: number;
}): Effect.Effect<string, WorkspaceE2EError> =>
  pollUntil(
    readPolledSession(session, readPageSnapshot).pipe(
      Effect.orElseSucceed(() => ""),
      Effect.map((snapshot) => (matches(snapshot) ? snapshot : undefined))
    ),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: description,
      timeoutMs,
    }
  );

/**
 * Waits until React has attached the form's `onSubmit` handler and the
 * `onChange` handler of each visible field, and the form carries the ready
 * attribute when one is required. A native submit before then falls back to a
 * document POST, and a fill before then is lost.
 */
export const waitForReactFormSubmit = (
  session: E2EBrowserSession,
  selector: string,
  visibleFieldSelectors: readonly string[],
  options: ReactFormSubmitOptions = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  session
    .use("wait for browser React form handlers", (page) =>
      page.waitForFunction(
        isReactFormSubmitReady,
        toReactFormSubmitQuery(selector, visibleFieldSelectors, options),
        { timeout: options.timeoutMs ?? 60_000 }
      )
    )
    .pipe(Effect.asVoid);

/**
 * Waits until React has hydrated the first element matching `selector`, that
 * is, the element carries React props.
 */
export const waitForReactHydration = (
  session: E2EBrowserSession,
  selector: string,
  { timeoutMs = 60_000 }: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  session
    .use("wait for browser React hydration", (page) =>
      page.waitForFunction(
        isReactHydrated,
        { selector },
        { timeout: timeoutMs }
      )
    )
    .pipe(Effect.asVoid);

/**
 * Waits until React has attached the `handler` prop, such as `onClick`, to
 * the first element matching `selector`.
 */
export const waitForReactHandler = (
  session: E2EBrowserSession,
  selector: string,
  handler: string,
  { timeoutMs = 60_000 }: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  session
    .use(`wait for browser React ${handler} handler`, (page) =>
      page.waitForFunction(
        hasReactHandler,
        { handler, selector },
        { timeout: timeoutMs }
      )
    )
    .pipe(Effect.asVoid);

/**
 * Waits until `condition`, a self-contained in-page function called with
 * `arg`, returns a truthy value. A condition that throws fails the wait.
 */
export const waitForPageCondition = <Arg>(
  session: E2EBrowserSession,
  description: string,
  condition: (arg: Arg) => unknown,
  arg: Arg,
  { timeoutMs = 60_000 }: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  session
    .use(`wait for ${description}`, (page) =>
      // Playwright types the argument as its serialized form; plain data is
      // the same shape.
      page.waitForFunction(condition as (arg: unknown) => unknown, arg, {
        timeout: timeoutMs,
      })
    )
    .pipe(Effect.asVoid);

/**
 * Focuses the visible match of `selector` and presses Enter, so the
 * element's own handler receives a trusted event.
 */
export const activateElement = (
  session: E2EBrowserSession,
  selector: string,
  { timeoutMs = 60_000 }: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* session.use("focus browser element", (page) =>
      page
        .locator(selector)
        .filter({ visible: true })
        .focus({ timeout: timeoutMs })
    );
    // As the argv `press` command, the key press has no timeout of its own;
    // the caller's step bounds it.
    yield* session.use("press browser key", (page) =>
      page.keyboard.press("Enter")
    );
  });

/** Waits for the element to hydrate, then activates it (`activateElement`). */
export const activateHydratedElement = (
  session: E2EBrowserSession,
  selector: string,
  options: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.andThen(
    waitForReactHydration(session, selector, options),
    activateElement(session, selector, options)
  );

/**
 * Evaluates `check`, a self-contained in-page function called with `arg`,
 * and fails with the problem it returns; `null` means the page holds. An
 * evaluation that overruns `timeoutMs` fails rather than timing out, as the
 * argv `eval` it replaces did, so `check` must never throw a named
 * `TimeoutError`.
 */
export const assertPageCheck = <Arg>(
  session: E2EBrowserSession,
  label: string,
  check: (arg: Arg) => string | null,
  arg: Arg,
  { timeoutMs }: { readonly timeoutMs: number }
): Effect.Effect<void, WorkspaceE2EError> =>
  session.evaluate(label, check, arg, { timeoutMs }).pipe(
    withoutWorkspaceE2ETimeout(label),
    Effect.flatMap((problem) =>
      problem === null
        ? Effect.void
        : Effect.fail(
            workspaceE2EError(`${label} failed: ${redact(problem)}`, {
              operation: label,
            })
          )
    )
  );

/**
 * Scrolls the first element matching `selector` to the viewport's center and
 * waits two animation frames for layout to settle. An evaluation that
 * overruns `timeoutMs` fails rather than timing out, as the argv `eval` it
 * replaces did.
 */
export const scrollIntoView = (
  session: E2EBrowserSession,
  selector: string,
  { timeoutMs = 60_000 }: { readonly timeoutMs?: number } = {}
): Effect.Effect<void, WorkspaceE2EError> =>
  session
    .evaluate(
      "scroll browser element into view",
      scrollElementIntoView,
      selector,
      { timeoutMs }
    )
    .pipe(withoutWorkspaceE2ETimeout("scroll browser element into view"));

/**
 * The active page's URL with registered secrets redacted, as argv output was,
 * or `undefined` when the page can't be read.
 */
export const readPageUrl = (
  session: E2EBrowserSession
): Effect.Effect<string | undefined> =>
  session
    .use("read browser URL", async (page) => page.url())
    .pipe(
      Effect.map((url) => redact(url).trim()),
      Effect.orElseSucceed(() => undefined)
    );

/**
 * Polls the active page's URL until `matches` accepts it. A wait that runs
 * out fails as a plain error, not a timeout, carrying the page diagnostics,
 * as the argv `waitForBrowserUrl` does.
 */
export const waitForPageUrl = ({
  description,
  matches,
  session,
  timeoutMs,
}: {
  readonly description: string;
  readonly matches: (url: string) => boolean;
  readonly session: PolledBrowserSession;
  readonly timeoutMs: number;
}): Effect.Effect<string, WorkspaceE2EError> =>
  pollForUrl(
    readPolledSession(session, readPageUrl).pipe(
      Effect.orElseSucceed(() => undefined)
    ),
    {
      description,
      matches,
      readDiagnostics: readPolledSession(
        session,
        readBrowserPageDiagnostics
      ).pipe(
        Effect.orElseSucceed(() => unavailableBrowserDiagnostics),
        Effect.map(redact),
        // The argv evaluation it replaces ran under the runner's default
        // command bound.
        Effect.timeoutOrElse({
          duration: `${argvCommandTimeoutMs} millis`,
          orElse: () => Effect.succeed(unavailableBrowserDiagnostics),
        })
      ),
      timeoutMs,
    }
  );

type PageTextOptions = {
  readonly caseSensitive?: boolean;
  readonly timeoutMs?: number;
};

type PageTextQuery = {
  readonly caseSensitive: boolean;
  /** Already lower-cased when the match ignores case. */
  readonly text: string;
};

const toPageTextQuery = (
  text: string,
  { caseSensitive = true }: PageTextOptions
): PageTextQuery => ({
  caseSensitive,
  text: caseSensitive ? text : text.toLocaleLowerCase(),
});

// The in-page functions below run in the browser, so they must not close over
// anything; argv callers get them as an expression through `inPageCall`
// (`browser-scripts.ts`).

const readBodyText = () => document.body?.innerText ?? "";

const pageTextIncludes = ({ caseSensitive, text }: PageTextQuery) => {
  const pageText = document.body?.innerText;
  return (
    (caseSensitive ? pageText : pageText?.toLocaleLowerCase())?.includes(
      text
    ) ?? false
  );
};

const isReactHydrated = ({ selector }: { readonly selector: string }) => {
  const element = document.querySelector(selector);
  return (
    element !== null &&
    Object.keys(element).some((key) => key.startsWith("__reactProps$"))
  );
};

const hasReactHandler = ({
  handler,
  selector,
}: {
  readonly handler: string;
  readonly selector: string;
}) => {
  const element = document.querySelector(selector);
  if (element === null) return false;
  const key = Object.keys(element).find((name) =>
    name.startsWith("__reactProps$")
  );
  const props: unknown =
    key === undefined ? undefined : Reflect.get(element, key);
  return (
    typeof props === "object" &&
    props !== null &&
    typeof Reflect.get(props, handler) === "function"
  );
};

const scrollElementIntoView = async (selector: string) => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error("scroll target not found");
  }
  element.scrollIntoView({
    behavior: "instant",
    block: "center",
    inline: "nearest",
  });
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
};

type ReactFormSubmitOptions = {
  readonly requiredReadyAttribute?: {
    readonly name: string;
    readonly value: string;
  };
  readonly timeoutMs?: number;
};

type ReactFormSubmitQuery = {
  readonly fieldSelectors: readonly string[];
  readonly formSelector: string;
  readonly readyAttribute: {
    readonly name: string;
    readonly value: string;
  } | null;
};

const toReactFormSubmitQuery = (
  formSelector: string,
  fieldSelectors: readonly string[],
  { requiredReadyAttribute }: ReactFormSubmitOptions
): ReactFormSubmitQuery => ({
  fieldSelectors,
  formSelector,
  readyAttribute: requiredReadyAttribute ?? null,
});

const isReactFormSubmitReady = ({
  fieldSelectors,
  formSelector,
  readyAttribute,
}: ReactFormSubmitQuery) => {
  const hasReactHandler = (element: Element, handler: string) => {
    const key = Object.keys(element).find((name) =>
      name.startsWith("__reactProps$")
    );
    const props: unknown =
      key === undefined
        ? undefined
        : Object.getOwnPropertyDescriptor(element, key)?.value;
    return (
      typeof props === "object" &&
      props !== null &&
      typeof Reflect.get(props, handler) === "function"
    );
  };
  const form = document.querySelector(formSelector);
  if (form === null || !hasReactHandler(form, "onSubmit")) return false;
  if (
    readyAttribute !== null &&
    form.getAttribute(readyAttribute.name) !== readyAttribute.value
  )
    return false;
  if (fieldSelectors.length === 0) return false;
  return fieldSelectors.every((fieldSelector) => {
    const field = document.querySelector(fieldSelector);
    if (field === null || !form.contains(field)) return false;
    if (field instanceof HTMLInputElement && field.type === "hidden")
      return true;
    const fieldStyle = window.getComputedStyle(field);
    const fieldIsVisible =
      field.getClientRects().length > 0 &&
      fieldStyle.display !== "none" &&
      fieldStyle.visibility === "visible";
    return fieldIsVisible && hasReactHandler(field, "onChange");
  });
};

/**
 * The checkout page summary diagnostics report: URL without its secret
 * parameters, title, alerts, body text, and the reservation action's state.
 * Runs in the browser.
 */
export const summarizeCheckoutPage = () => {
  const cleanUrl = (value: string) => {
    try {
      const url = new URL(value);
      for (const key of [
        "payState",
        "contact",
        "checkoutToken",
        "accessToken",
        "_vercel_share",
        "x-vercel-protection-bypass",
      ]) {
        if (url.searchParams.has(key)) url.searchParams.set(key, "[redacted]");
      }
      return url.toString();
    } catch {
      return "[unavailable]";
    }
  };
  const submit = document.querySelector(
    "#reservation-continue, #reservation-submit"
  );
  const alerts = [...document.querySelectorAll('[role="alert"]')]
    .map((element) => element.textContent?.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return {
    alerts,
    body: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 1200),
    submitDisabled:
      submit instanceof HTMLButtonElement ? submit.disabled : null,
    submitText: submit?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    title: document.title,
    url: cleanUrl(location.href),
  };
};

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
      page.evaluate(summarizeCheckoutPage)
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
