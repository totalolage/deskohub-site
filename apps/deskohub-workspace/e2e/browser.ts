import type { Locator, Page } from "@playwright/test";
import { Effect } from "effect";
import type {
  E2EBrowserSession,
  OpenE2EBrowserSession,
} from "./browser-session";
import type { WorkspaceE2EConfig } from "./config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  withoutWorkspaceE2ETimeout,
  workspaceE2EError,
} from "./errors";
import { pollUntil } from "./polling";
import { redact } from "./redaction";
import { log } from "./runtime";
import {
  urlWaitDiagnosticsTimeoutMs,
  workspaceE2EPollIntervalMs,
} from "./timeouts";

export const normalizeBrowserText = (text: string) =>
  text.replaceAll(/\s+/g, " ").trim();

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
 * secret, then loads the URL in the session's active page and keeps that
 * page active.
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
 * The page's visible text with registered secrets redacted. A read that
 * overruns its 30 s bound fails rather than timing out.
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
 * The session a poller reads, or the opener that yields it
 * (`OpenE2EBrowserSession`). A poller yields an opener on every read, so a
 * browser that fails to open reads as an unreadable page.
 */
export type PolledBrowserSession = E2EBrowserSession | OpenE2EBrowserSession;

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
 * secrets redacted. Each Playwright wait is bounded by 60 s.
 */
export const readPageSnapshot = (
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
 * The element a `readPageSnapshot` line names by its `[ref=…]`, through
 * Playwright's own AI-snapshot ref engine. A frame-scoped ref (`f1e6`)
 * resolves inside its iframe.
 */
export const locateSnapshotRef = (page: Page, ref: string): Locator =>
  page.locator(`aria-ref=${ref}`);

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
    // The key press has no timeout of its own; the caller's step bounds it.
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
 * evaluation that overruns `timeoutMs` fails rather than timing out, so
 * `check` must never throw a named `TimeoutError`.
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
 * overruns `timeoutMs` fails rather than timing out.
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

/** The page the session drives now; a closed page fails the read. */
export const readActivePage = (
  session: E2EBrowserSession
): Effect.Effect<Page, WorkspaceE2EError> =>
  session.use("read active browser tab", async (page) => {
    if (page.isClosed()) throw new Error("no active browser tab");
    return page;
  });

/**
 * The session's request and response log, one entry per line. The session
 * redacts each entry.
 */
export const readNetworkLog = (
  session: E2EBrowserSession
): Effect.Effect<string> =>
  session.diagnostics.pipe(Effect.map(({ requests }) => requests.join("\n")));

/**
 * The active page's URL with registered secrets redacted, or `undefined`
 * when the page can't be read.
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
 * out fails as a plain error, not a timeout, carrying the page diagnostics.
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
        Effect.timeoutOrElse({
          duration: `${urlWaitDiagnosticsTimeoutMs} millis`,
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
// anything.

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
