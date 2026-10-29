import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { testEmailAddress } from "@deskohub/test-email";
import { type Browser, type BrowserContext, chromium } from "@playwright/test";
import { Effect } from "effect";
import { m } from "@/features/i18n";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { normalizeBrowserText } from "../browser";
import { runE2ECase } from "../case-runner";
import {
  type BrowserStepDriver,
  failedStepAnnotation,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import type { WorkspaceE2EError } from "../errors";
import { makePlaywrightBrowserRunner, type Runner } from "../runtime";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import { makeWorkspaceE2EAccountLaneBrowser } from "./lane-browser";

const laneEmail = testEmailAddress("lane-browser");

// The account cases drive these steps on the lane's page and the assistant's,
// so each runs through the real argv runner's sessions, as in the lane.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

const czechNewLink = m.accountCallbackFailedAction({}, { locale: "cs-CZ" });

// Hands React props with the named handlers to the element, as React's own
// `__reactProps$` key carries them.
const reactProps = (selector: string, handlers: readonly string[]) =>
  `document.querySelector(${JSON.stringify(selector)}).__reactProps$test = Object.fromEntries(${JSON.stringify(handlers)}.map((name) => [name, () => {}]));`;

const html = (body: string) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );

/**
 * The pages the lane's steps meet. `hydrate=0` leaves the controls without
 * React handlers, and `/hang` never answers.
 */
const server = Bun.serve({
  fetch: (request) => {
    const url = new URL(request.url);
    const hydrate = url.searchParams.get("hydrate") !== "0";
    switch (url.pathname) {
      case "/hang":
        return new Promise<Response>(() => undefined);
      // A locale link the proxy sends back to the old locale.
      case "/cs-CZ/redirected":
        return new Response(null, {
          headers: { location: "/en-US/elsewhere" },
          status: 307,
        });
      case "/en-US/auth/sign-in":
        return html(`<p>cookie:<span id="cookie"></span></p>
          <form id="account-sign-in-form">
            <input id="account-sign-in-email" type="email">
            <button id="account-sign-in-submit" type="submit">Send</button>
          </form>
          <script>
            document.getElementById("cookie").textContent = document.cookie;
            const form = document.getElementById("account-sign-in-form");
            form.addEventListener("submit", (event) => {
              event.preventDefault();
              const email = document.getElementById("account-sign-in-email").value;
              document.body.innerHTML = '<p>Accepted ' + email + '</p><input id="account-sign-in-code">';
              ${hydrate ? reactProps("#account-sign-in-code", ["onChange"]) : ""}
            });
            ${hydrate ? `${reactProps("#account-sign-in-form", ["onSubmit"])}${reactProps("#account-sign-in-email", ["onChange"])}` : ""}
          </script>`);
      case "/en-US/account":
        return html(
          `<button id="account-sign-out" onclick="location.assign('/en-US')">Sign out</button>`
        );
      case "/en-US":
      case "/cs-CZ": {
        const other = url.pathname === "/en-US" ? "/cs-CZ" : "/en-US";
        const target = url.searchParams.get("target") ?? other;
        return html(`<p>Home ${url.pathname}</p>
          <nav data-locale-switcher><a href="${target}">${other}</a></nav>
          ${hydrate ? `<script>${reactProps("[data-locale-switcher] a", ["onClick"])}</script>` : ""}`);
      }
      case "/cs-CZ/auth/callback":
        return html(`<p>Callback failed</p>
          <a hidden href="/cs-CZ/hidden">${czechNewLink}</a>
          <a href="/cs-CZ/auth/sign-in?returnTo=%2Fcs-CZ%2Freservation">${czechNewLink}</a>`);
      case "/en-US/reservation/cowork": {
        const checked = url.searchParams.get("checked");
        return html(
          ["open-space", "fixed-desk"]
            .map(
              (tier) =>
                `<input type="radio" name="entryTier" value="${tier}"${tier === checked ? " checked" : ""}>`
            )
            .join("")
        );
      }
      default:
        return html(`<p>Page ${url.pathname}</p>`);
    }
  },
  hostname: "127.0.0.1",
  port: 0,
});
const origin = server.url.origin;

afterAll(async () => {
  await browser?.close();
  await server.stop(true);
});

// Short bounds, so a wait that never succeeds settles quickly.
const config = {
  baseUrl: origin,
  bypassSecret: undefined,
  timeouts: {
    ...workspaceE2ETimeouts,
    browserAction: 2000,
    browserNavigation: 3000,
    browserSessionClose: 1000,
    uiTransition: 2000,
  },
};

const laneBrowserFor = (run: Runner, session: string) =>
  makeWorkspaceE2EAccountLaneBrowser({ config, run, session });

/** Runs `drive` on the lane browser of a fresh runner as one C03 step. */
const runLaneStep = <A>(
  drive: (
    laneBrowser: ReturnType<typeof laneBrowserFor>
  ) => Effect.Effect<A, WorkspaceE2EError>,
  options: { readonly stepTimeoutMs?: number } = {}
) => {
  if (!browser) throw new Error("Chromium is not running");
  return runBrowserStep({
    browser,
    drive: ({ id, run }: BrowserStepDriver) => drive(laneBrowserFor(run, id)),
    prepare: () => Effect.void,
    stepTimeoutMs: options.stepTimeoutMs ?? 15_000,
  });
};

test.skipIf(!chromiumAvailable)(
  "signs in through the form on the page the argv commands share",
  async () => {
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/auth/sign-in`);
        yield* laneBrowser.waitForSignInForm;
        yield* laneBrowser.submitSignInEmail(laneEmail);
        const accepted = yield* laneBrowser.waitForText(
          "accepted sign-in",
          (text) => text.includes("Accepted"),
          2000
        );
        yield* laneBrowser.waitForSignInCodeInput;
        const landed = yield* laneBrowser.waitForUrl(
          "sign-in page",
          (url) => new URL(url).pathname === "/en-US/auth/sign-in",
          2000
        );
        return {
          accepted,
          landed: new URL(landed).pathname,
          text: yield* laneBrowser.readText,
          url: yield* laneBrowser.readUrl,
        };
      })
    );

    expect(result.annotations).toEqual([]);
    expect(result.value).toEqual({
      accepted: `Accepted ${laneEmail}`,
      landed: "/en-US/auth/sign-in",
      text: `Accepted ${laneEmail}`,
      url: `${origin}/en-US/auth/sign-in`,
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "follows the account, callback and cowork pages' controls",
  async () => {
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/account`);
        yield* laneBrowser.signOut;
        const signedOut = yield* laneBrowser.waitForUrl(
          "bare locale root",
          (url) => new URL(url).pathname === "/en-US",
          2000
        );
        yield* laneBrowser.open(`${origin}/cs-CZ/auth/callback?error=used`);
        yield* laneBrowser.requestNewLinkAfterFailedCallback("cs-CZ");
        const newLink = yield* laneBrowser.waitForUrl(
          "sign-in after the failed link",
          (url) => new URL(url).pathname === "/cs-CZ/auth/sign-in",
          2000
        );
        yield* laneBrowser.open(
          `${origin}/en-US/reservation/cowork?checked=open-space`
        );
        yield* laneBrowser.waitForCoworkSelection("selection", "open-space");
        return {
          newLink: new URL(newLink).searchParams.get("returnTo"),
          signedOut: new URL(signedOut).pathname,
        };
      })
    );

    expect(result.annotations).toEqual([]);
    expect(result.value).toEqual({
      newLink: "/cs-CZ/reservation",
      signedOut: "/en-US",
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "switches the locale through the hydrated switcher link",
  async () => {
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US`);
        yield* laneBrowser.switchLocale("cs-CZ");
        return yield* laneBrowser.readUrl;
      })
    );

    expect(result.annotations).toEqual([]);
    expect(result.value).toBe(`${origin}/cs-CZ`);
  }
);

/** How each step that can't reach its page state fails its case. */
const failingSteps: ReadonlyArray<
  readonly [
    string,
    "error" | "timeout",
    (
      laneBrowser: ReturnType<typeof laneBrowserFor>
    ) => Effect.Effect<unknown, WorkspaceE2EError>,
  ]
> = [
  [
    "a page that never loads",
    "timeout",
    (laneBrowser) => laneBrowser.open(`${origin}/hang`),
  ],
  [
    "a sign-in form without React handlers",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/auth/sign-in?hydrate=0`),
        laneBrowser.waitForSignInForm
      ),
  ],
  [
    "a missing email field",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.submitSignInEmail(laneEmail)
      ),
  ],
  [
    "a code input without its handler",
    "timeout",
    (laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/auth/sign-in?hydrate=0`);
        yield* laneBrowser.submitSignInEmail(laneEmail);
        yield* laneBrowser.waitForSignInCodeInput;
      }),
  ],
  [
    "text that never shows",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.waitForText("missing text", () => false, 1000)
      ),
  ],
  [
    "a URL that never matches",
    "error",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.waitForUrl("missing URL", () => false, 1000)
      ),
  ],
  [
    "a missing sign-out button",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/auth/sign-in`),
        laneBrowser.signOut
      ),
  ],
  [
    "a failure card in another locale",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/cs-CZ/auth/callback?error=used`),
        laneBrowser.requestNewLinkAfterFailedCallback("en-US")
      ),
  ],
  [
    "another selected entry tier",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(
          `${origin}/en-US/reservation/cowork?checked=fixed-desk`
        ),
        laneBrowser.waitForCoworkSelection("selection", "open-space")
      ),
  ],
  [
    "a locale link that is not hydrated",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US?hydrate=0`),
        laneBrowser.switchLocale("cs-CZ")
      ),
  ],
  [
    "a locale link that lands elsewhere",
    "error",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US?target=/cs-CZ/redirected`),
        laneBrowser.switchLocale("cs-CZ")
      ),
  ],
];

test.skipIf(!chromiumAvailable)(
  "classifies each step that can't reach its page state",
  async () => {
    const results = await Promise.all(
      failingSteps.map(async ([name, failureKind, drive]) => {
        const result = await runLaneStep(drive);
        return {
          annotations: result.annotations,
          expected: failedStepAnnotation(failureKind),
          name,
          timeout: result.failures.map(({ timeout }) => timeout),
        };
      })
    );

    for (const { annotations, expected, name, timeout } of results) {
      expect({ annotations, name }).toEqual({ annotations: expected, name });
      expect({ name, timeout }).toEqual({
        name,
        timeout: [expected[0]?.failureKind === "timeout"],
      });
    }
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "reads a lane browser that cannot open as an unreadable page",
  async () => {
    const closed = await chromium.launch({ headless: true });
    await closed.close();
    const outcomes = await Promise.all(
      [
        (laneBrowser: ReturnType<typeof laneBrowserFor>) =>
          laneBrowser.readUrl.pipe(Effect.map((url) => ({ url }))),
        (laneBrowser: ReturnType<typeof laneBrowserFor>) =>
          laneBrowser.waitForText(
            "text",
            (text) => text.includes("Home"),
            1000
          ),
        (laneBrowser: ReturnType<typeof laneBrowserFor>) =>
          laneBrowser.waitForUrl("URL", (url) => url.includes("/en-US"), 1000),
        (laneBrowser: ReturnType<typeof laneBrowserFor>) =>
          laneBrowser.open(`${origin}/en-US`),
      ].map(async (drive) => {
        const run = makePlaywrightBrowserRunner(closed, { recordHar: false });
        const observations: E2ETelemetryObservation[] = [];
        const failures: WorkspaceE2EError[] = [];
        let value: unknown;
        try {
          await Effect.runPromiseExit(
            runE2ECase({
              body: (step) =>
                step({
                  execute: drive(
                    laneBrowserFor(run, `account-lane-${randomUUID()}`)
                  ).pipe(
                    Effect.tap((driven) =>
                      Effect.sync(() => {
                        value = driven;
                      })
                    ),
                    Effect.tapError((failure) =>
                      Effect.sync(() => failures.push(failure))
                    )
                  ),
                  id: "drive-browser-step",
                  timeoutMs: 10_000,
                }),
              caseId: "browser-step",
              watchdogMs: 15_000,
            }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
          );
          return {
            annotations: observations
              .filter(({ scope }) => scope === "annotation")
              .map(({ scope: _scope, ...annotation }) => annotation),
            diagnostics: failures.map(({ message }) =>
              message.endsWith("\nBrowser diagnostics unavailable")
            ),
            value,
          };
        } finally {
          await run.close?.();
        }
      })
    );

    // As argv reads that allowed failure: no URL, polls that run out, and a
    // URL wait that reports no diagnostics. Only the load itself fails.
    expect(outcomes).toEqual([
      { annotations: [], diagnostics: [], value: { url: undefined } },
      {
        annotations: failedStepAnnotation("timeout"),
        diagnostics: [false],
        value: undefined,
      },
      {
        annotations: failedStepAnnotation("error"),
        diagnostics: [true],
        value: undefined,
      },
      {
        annotations: failedStepAnnotation("error"),
        diagnostics: [false],
        value: undefined,
      },
    ]);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "keeps the assistant's browser in its own context until it closes",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
    const lane = `account-lane-${randomUUID()}`;
    const laneBrowser = laneBrowserFor(run, lane);
    try {
      const observed = await Effect.runPromise(
        Effect.gen(function* () {
          yield* laneBrowser.open(`${origin}/en-US/account`);
          // The lane remembers a cookie the assistant's browser never sees.
          yield* Effect.promise(() =>
            run("playwright", ["--session", lane, "eval", "--stdin"], {
              input: `document.cookie = "lane=1; path=/"`,
              logCommand: false,
              logOutput: false,
            })
          );
          yield* laneBrowser.open(`${origin}/en-US/auth/sign-in`);
          yield* laneBrowser.assistant.open(`${origin}/en-US/auth/sign-in`);
          const assistantText = normalizeBrowserText(
            yield* laneBrowser.assistant.readText
          );
          yield* laneBrowser.assistant.close;
          const afterClose = yield* laneBrowser.assistant.readText.pipe(
            Effect.match({
              onFailure: () => "failed" as const,
              onSuccess: () => "read" as const,
            })
          );
          return {
            afterClose,
            assistantText,
            laneText: normalizeBrowserText(yield* laneBrowser.readText),
          };
        })
      );
      expect(observed).toEqual({
        afterClose: "failed",
        assistantText: "cookie: Send",
        laneText: "cookie:lane=1 Send",
      });
    } finally {
      await run.close?.();
    }
  }
);

/**
 * Runs the assistant's part of the reactivation case, as the account case
 * does: its steps, then its close in `Effect.ensuring`, with the assistant's
 * browser context either never opening or never closing until released.
 */
const runAssistantCase = async (hold: "close" | "open") => {
  if (!browser) throw new Error("Chromium is not running");
  const real = browser;
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  let contexts = 0;
  const held = new Proxy(real, {
    get: (target, property) =>
      property === "newContext"
        ? async (options?: Parameters<Browser["newContext"]>[0]) => {
            contexts += 1;
            // The lane's own context opens first; the assistant's second.
            if (contexts < 2) return target.newContext(options);
            if (hold === "open") {
              await released;
              return target.newContext(options);
            }
            const context: BrowserContext = await target.newContext(options);
            const close = context.close.bind(context);
            context.close = async (closeOptions) => {
              await released;
              await close(closeOptions);
            };
            return context;
          }
        : Reflect.get(target, property, target),
  });
  const run = makePlaywrightBrowserRunner(held, { recordHar: false });
  const laneBrowser = laneBrowserFor(run, `account-lane-${randomUUID()}`);
  const observations: E2ETelemetryObservation[] = [];
  const started = Date.now();
  try {
    await Effect.runPromise(laneBrowser.open(`${origin}/en-US/account`));
    const settled = Effect.runPromiseExit(
      runE2ECase({
        body: (step) =>
          Effect.gen(function* () {
            yield* step({
              execute: laneBrowser.assistant.open(`${origin}/en-US/account`),
              id: "open-assistant-browser",
              timeoutMs: 2000,
            });
            yield* step({
              execute: laneBrowser.assistant.readText,
              id: "read-assistant-page",
              timeoutMs: 2000,
            });
          }).pipe(Effect.ensuring(laneBrowser.assistant.close)),
        caseId: "assistant-browser",
        watchdogMs: 20_000,
      }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
    ).then(() => Date.now() - started);
    const elapsedMs = await Promise.race([
      settled,
      Bun.sleep(12_000).then(() => undefined),
    ]);
    release();
    await settled;
    return {
      annotations: observations
        .filter(({ scope }) => scope === "annotation")
        .map(({ scope: _scope, ...annotation }) => annotation),
      elapsedMs,
    };
  } finally {
    release();
    await run.close?.();
  }
};

test.skipIf(!chromiumAvailable)(
  "stops waiting for an assistant's browser that never opens",
  async () => {
    const { annotations, elapsedMs } = await runAssistantCase("open");

    expect(annotations).toEqual([
      {
        caseId: "assistant-browser",
        failureKind: "timeout",
        outcome: "timed_out",
        stepId: "open-assistant-browser",
      },
    ]);
    // The step deadline, then at most `browserSessionClose` for the close.
    expect(elapsedMs).toBeLessThan(2000 + 1000 + 3000);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "ignores an assistant's browser close that stalls past its bound",
  async () => {
    const { annotations, elapsedMs } = await runAssistantCase("close");

    expect(annotations).toEqual([]);
    expect(elapsedMs).toBeLessThan(1000 + 5000);
  },
  60_000
);
