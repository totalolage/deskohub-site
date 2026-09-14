import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "@playwright/test";
import {
  type Account,
  betterAuth,
  type RateLimit,
  type Session,
  type User,
  type Verification,
} from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { magicLink } from "better-auth/plugins";
import { withCallbackHandoffReview } from "../../e2e/account/callback-handoff";

const APP_ROOT = resolve(import.meta.dir, "../..");
const AUTH_RETURN_SOURCE = resolve(import.meta.dir, "auth-return.ts");
const AUTH_CLIENT_SOURCE = resolve(import.meta.dir, "auth.client.ts");
const CALLBACK_REDIRECT_SOURCE = resolve(
  import.meta.dir,
  "components/auth-callback-redirect.tsx"
);
const REACT_SOURCE = resolve(APP_ROOT, "node_modules/react/index.js");
const REACT_DOM_CLIENT_SOURCE = resolve(
  APP_ROOT,
  "node_modules/react-dom/client.js"
);
const FIXTURE_BUNDLE_NAME = "/auth-return-browser.fixture.js";
const ACCOUNT_PATH = "/en-US/account";
const CALLBACK_PATH = "/en-US/auth/callback";
const SESSION_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;
const STUB_ATTEMPT_ID = "550e8400-e29b-41d4-a716-446655440000";
const ACCOUNT_REVIEW_SCREENSHOT_PATH = resolve(
  APP_ROOT,
  "e2e-artifacts/account-review/callback-loading-desktop.png"
);
const ACCOUNT_REVIEW_SCREENSHOT_NAME = "callback-loading-desktop.png";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const VALID_ATTEMPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MemoryAuthStore = {
  readonly user: User[];
  readonly session: Session[];
  readonly account: Account[];
  readonly verification: Verification[];
  readonly rateLimit: RateLimit[];
};

type CapturedMagicLink = {
  readonly email: string;
  readonly url: string;
};

type VerificationMode = "normal" | "stale" | "unverified";

type ServerObservations = {
  readonly events: string[];
  readonly verificationCookieByAttempt: Map<string, boolean>;
  readonly verificationLocationByAttempt: Map<string, string>;
  readonly errorCallbacks: string[];
  verificationRedirects: number;
  verificationResponsesWithSessionCookie: number;
  callbackRequests: number;
  callbacksBeforeVerificationCookie: number;
  getSessionRequests: number;
  getSessionRequestsWithCookie: number;
  verifiedSessionResponses: number;
  unverifiedSessionResponses: number;
};

type FixtureServer = {
  readonly origin: string;
  readonly links: CapturedMagicLink[];
  readonly store: MemoryAuthStore;
  readonly observations: ServerObservations;
  readonly close: () => void;
};

type BrowserScenario = {
  readonly context: BrowserContext;
  readonly server: FixtureServer;
};

type FixtureApi = {
  readonly cancel: () => void;
  readonly setCallbackURL: (url: string) => void;
  readonly start: (options: {
    readonly email: string;
    readonly requireFreshSession?: boolean;
  }) => Promise<boolean>;
};

declare global {
  interface Window {
    readonly __deskohubAuthReturnFixture: FixtureApi;
  }
}

const fixtureEmail = {
  invalid: "auth-return-invalid@deskohub.test",
  isolatedFirst: "auth-return-first@deskohub.test",
  isolatedSecond: "auth-return-second@deskohub.test",
  noAck: "auth-return-no-ack@deskohub.test",
  replayPending: "auth-return-replay-pending@deskohub.test",
  review: "auth-return-review@deskohub.test",
  unverified: "auth-return-unverified@deskohub.test",
  verified: "auth-return-verified@deskohub.test",
} as const;

let fixtureDirectory: string | undefined;
let fixtureBundle = "";
let browser: Browser | undefined;

const wait = (milliseconds: number) =>
  new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });

const waitUntil = async (
  description: string,
  predicate: () => boolean,
  timeoutMs = 5000
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const resolveFixtureFile = (basePath: string) => {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    join(basePath, "index.ts"),
    join(basePath, "index.tsx"),
    join(basePath, "index.js"),
    join(basePath, "index.jsx"),
  ];
  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
};

const makeObservations = (): ServerObservations => ({
  events: [],
  verificationCookieByAttempt: new Map(),
  verificationLocationByAttempt: new Map(),
  errorCallbacks: [],
  verificationRedirects: 0,
  verificationResponsesWithSessionCookie: 0,
  callbackRequests: 0,
  callbacksBeforeVerificationCookie: 0,
  getSessionRequests: 0,
  getSessionRequestsWithCookie: 0,
  verifiedSessionResponses: 0,
  unverifiedSessionResponses: 0,
});

const hasSessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .some((cookie) =>
      /(?:^|;)\s*(?:__Secure-)?better-auth\.session_token=/.test(cookie)
    );

const hasSessionCookieHeader = (request: Request) =>
  /(?:^|;)\s*(?:__Secure-)?better-auth\.session_token=/.test(
    request.headers.get("cookie") ?? ""
  );

const readCallbackAttempt = (location: string | null) => {
  if (!location) return "";
  try {
    return new URL(location).searchParams.get("attempt") ?? "";
  } catch {
    return "";
  }
};

const makeFixtureServer = async (
  verificationMode: VerificationMode = "normal"
): Promise<FixtureServer> => {
  const links: CapturedMagicLink[] = [];
  const store: MemoryAuthStore = {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  };
  const observations = makeObservations();
  const document = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Deskohub auth return fixture</title></head>
  <body>
    <header data-fixture="banner">Deskohub Workspace</header>
    <main><div id="root"></div></main>
    <footer data-fixture="contentinfo">Deskohub Workspace</footer>
    <script src="${FIXTURE_BUNDLE_NAME}"></script>
  </body>
</html>`;

  let authHandler: ((request: Request) => Promise<Response>) | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);

      if (url.pathname === FIXTURE_BUNDLE_NAME) {
        return new Response(fixtureBundle, {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/javascript; charset=utf-8",
          },
        });
      }

      if (url.pathname.startsWith("/api/auth/")) {
        if (!authHandler)
          return new Response("Auth fixture is not ready", { status: 503 });

        if (url.pathname === "/api/auth/get-session") {
          observations.getSessionRequests += 1;
          const hasCookie = hasSessionCookieHeader(request);
          if (hasCookie) {
            observations.getSessionRequestsWithCookie += 1;
            observations.events.push("get-session-with-cookie");
          } else {
            observations.events.push("get-session-without-cookie");
          }

          const response = await authHandler(request);
          const body = (await response
            .clone()
            .json()
            .catch(() => null)) as {
            readonly user?: { readonly emailVerified?: boolean };
          } | null;
          if (body?.user?.emailVerified === true) {
            observations.verifiedSessionResponses += 1;
            observations.events.push("get-session-verified");
          } else if (body?.user?.emailVerified === false) {
            observations.unverifiedSessionResponses += 1;
            observations.events.push("get-session-unverified");
          }
          return response;
        }

        const response = await authHandler(request);
        if (url.pathname !== "/api/auth/magic-link/verify") return response;

        const location = response.headers.get("location");
        const callbackAttempt = readCallbackAttempt(location);
        if (location && new URL(location).pathname === CALLBACK_PATH) {
          const sessionCookie = hasSessionCookie(response);
          observations.verificationRedirects += 1;
          observations.verificationCookieByAttempt.set(
            callbackAttempt,
            sessionCookie
          );
          observations.verificationLocationByAttempt.set(
            callbackAttempt,
            location
          );
          observations.events.push(
            sessionCookie
              ? "verification-response-with-cookie"
              : "verification-response-without-cookie"
          );

          if (sessionCookie) {
            observations.verificationResponsesWithSessionCookie += 1;
            if (verificationMode === "stale") {
              for (const session of store.session) {
                session.createdAt = new Date(
                  Date.now() - SESSION_FRESHNESS_WINDOW_MS - 1000
                );
              }
            }
            if (verificationMode === "unverified") {
              for (const user of store.user) user.emailVerified = false;
            }
          }
        }
        return response;
      }

      if (url.pathname === CALLBACK_PATH) {
        observations.callbackRequests += 1;
        const attempt = url.searchParams.get("attempt") ?? "";
        if (url.searchParams.get("error")) {
          observations.errorCallbacks.push(attempt);
          observations.events.push("callback-request-with-error");
        }
        if (observations.verificationCookieByAttempt.get(attempt) !== true) {
          observations.callbacksBeforeVerificationCookie += 1;
        }
        observations.events.push("callback-request");
        return new Response(document, {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.pathname === ACCOUNT_PATH) {
        return new Response(
          "<!doctype html><html><body><main>account</main></body></html>",
          {
            headers: {
              "cache-control": "no-store",
              "content-type": "text/html; charset=utf-8",
            },
          }
        );
      }

      if (url.pathname.startsWith("/en-US/")) {
        return new Response(document, {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  const origin = `http://127.0.0.1:${server.port}`;
  const auth = betterAuth({
    appName: "Deskohub auth return browser fixture",
    baseURL: origin,
    secret: "deskohub-auth-return-browser-fixture-secret",
    database: memoryAdapter(store),
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        expiresIn: 600,
        rateLimit: { max: 50, window: 600 },
        sendMagicLink: ({ email, url }) => {
          links.push({ email, url });
        },
      }),
    ],
  });
  authHandler = auth.handler;

  return {
    origin,
    links,
    store,
    observations,
    close: () => server.stop(true),
  };
};

const createFixtureBundle = async () => {
  fixtureDirectory = await mkdtemp(
    join(tmpdir(), "deskohub-auth-return-browser-")
  );
  const entrypoint = join(fixtureDirectory, "auth-return-browser.fixture.tsx");
  const missingHandoffStub =
    Bun.env.AUTH_RETURN_BROWSER_REGRESSION_STUB === "missing-handoff";
  const lifecycleSource = missingHandoffStub
    ? join(fixtureDirectory, "auth-return.missing-handoff.ts")
    : AUTH_RETURN_SOURCE;

  if (missingHandoffStub) {
    await writeFile(
      lifecycleSource,
      `import { authClient } from ${JSON.stringify(AUTH_CLIENT_SOURCE)};

export const createAuthReturnLifecycle = ({ locale }) => ({
  cancel() {},
  sendMagicLink: (email) =>
    authClient.signIn.magicLink({
      email,
      callbackURL: "/" + locale + "/auth/callback?attempt=${STUB_ATTEMPT_ID}",
      metadata: { locale },
    }),
});
`
    );
  }

  await writeFile(
    entrypoint,
    `import { createElement } from ${JSON.stringify(REACT_SOURCE)};
import { createRoot } from ${JSON.stringify(REACT_DOM_CLIENT_SOURCE)};
import { createAuthReturnLifecycle } from ${JSON.stringify(lifecycleSource)};
import { AuthCallbackRedirect } from ${JSON.stringify(CALLBACK_REDIRECT_SOURCE)};

const state = { callbackURL: "", lifecycle: undefined };
const fixture = {
  cancel() {
    state.lifecycle?.cancel();
  },
  setCallbackURL(url) {
    state.callbackURL = url;
  },
  async start({ email, requireFreshSession = false }) {
    const lifecycle = createAuthReturnLifecycle({
      locale: "en-US",
      requireFreshSession,
    });
    state.lifecycle = lifecycle;
    const result = await lifecycle.sendMagicLink(email);
    document.documentElement.dataset.magicLinkState = result.error ? "error" : "sent";
    return !result.error;
  },
};

window.__deskohubAuthReturnFixture = fixture;

if (window.location.pathname === ${JSON.stringify(CALLBACK_PATH)}) {
  const root = document.getElementById("root");
  if (!root) throw new Error("callback fixture root is missing");
  createRoot(root).render(
    createElement(AuthCallbackRedirect, { locale: "en-US" })
  );
} else {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "open-callback";
  button.textContent = "Open callback";
  button.addEventListener("click", () => {
    if (state.callbackURL) window.open(state.callbackURL, "_blank");
  });
  document.body.append(button);
}
`
  );

  const build = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "iife",
    minify: false,
    sourcemap: "none",
    plugins: [
      {
        name: "deskohub-workspace-alias",
        setup(build) {
          build.onResolve({ filter: /^@\// }, ({ path }) => {
            const filePath = resolveFixtureFile(
              resolve(APP_ROOT, path.slice(2))
            );
            if (!filePath)
              throw new Error(`Workspace alias target is missing: ${path}`);
            return { path: filePath };
          });
          build.onResolve({ filter: /^\.\.?\// }, ({ path, resolveDir }) => {
            const filePath = resolveFixtureFile(resolve(resolveDir, path));
            return filePath ? { path: filePath } : undefined;
          });
        },
      },
    ],
  });

  if (!build.success) {
    throw new Error(
      build.logs
        .map((log) => log.message)
        .filter(Boolean)
        .join("\n") || "auth return browser fixture build failed"
    );
  }

  const output = build.outputs[0];
  if (!output) throw new Error("auth return browser fixture output is missing");
  fixtureBundle = await output.text();
};

const runScenario = async <T>(
  verificationMode: VerificationMode,
  action: (scenario: BrowserScenario) => Promise<T>
): Promise<T> => {
  if (!browser) throw new Error("Chromium fixture is not ready");
  const server = await makeFixtureServer(verificationMode);
  const context = await browser.newContext();
  try {
    return await action({ context, server });
  } finally {
    await context.close();
    server.close();
  }
};

const openInitiator = async (
  context: BrowserContext,
  server: FixtureServer
) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/en-US/sign-in`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Open callback" }).waitFor({
    state: "visible",
  });
  return page;
};

const startMagicLink = async (
  page: Page,
  server: FixtureServer,
  email: string,
  options: { readonly requireFreshSession?: boolean } = {}
) => {
  const linkIndex = server.links.length;
  const accepted = await page.evaluate(
    async ({ email: currentEmail, requireFreshSession }) => {
      const fixture = window.__deskohubAuthReturnFixture;
      return fixture.start({
        email: currentEmail,
        requireFreshSession,
      });
    },
    { email, requireFreshSession: options.requireFreshSession }
  );
  expect(accepted).toBe(true);
  await waitUntil("captured magic link", () => server.links.length > linkIndex);
  return server.links[linkIndex]!;
};

const callbackURLFromLink = (link: CapturedMagicLink) => {
  const callbackURL = new URL(link.url).searchParams.get("callbackURL");
  if (!callbackURL) throw new Error("captured magic link callback is missing");
  return callbackURL;
};

const attemptFromCallbackURL = (callbackURL: string) => {
  const attempt =
    new URL(callbackURL, "http://deskohub-auth-return.test").searchParams.get(
      "attempt"
    ) ?? "";
  if (!VALID_ATTEMPT_ID_PATTERN.test(attempt)) {
    throw new Error("captured callback attempt is not a UUID");
  }
  return attempt;
};

const setCallbackURL = async (page: Page, linkURL: string) => {
  await page.evaluate((url) => {
    const fixture = window.__deskohubAuthReturnFixture;
    fixture.setCallbackURL(url);
  }, linkURL);
};

const openScriptCallback = async (
  context: BrowserContext,
  initiator: Page,
  link: CapturedMagicLink
) => {
  await setCallbackURL(initiator, link.url);
  const popupPromise = context.waitForEvent("page");
  await initiator.getByRole("button", { name: "Open callback" }).click();
  return popupPromise;
};

const waitForAccount = (page: Page, server: FixtureServer) =>
  page.waitForURL(`${server.origin}${ACCOUNT_PATH}`, { timeout: 7000 });

const waitForPageClose = (page: Page, timeoutMs = 7000) =>
  new Promise<void>((resolvePromise, reject) => {
    if (page.isClosed()) {
      resolvePromise();
      return;
    }
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for callback tab to close"));
    }, timeoutMs);
    page.once("close", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });

const waitForPageCloseObservation = (
  page: Page,
  observations: ServerObservations
) =>
  waitForPageClose(page).then(() => {
    observations.events.push("callback-tab-closed");
  });

const isBrowserSuiteChildProcess =
  process.env.AUTH_RETURN_BROWSER_CHILD_PROCESS === "1";

const spawnIsolatedBrowserSuite = async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      "--preload",
      "./shared/testing/workspace-test-env.ts",
      "--parallel=1",
      "--timeout",
      "30000",
      import.meta.path,
    ],
    {
      cwd: APP_ROOT,
      env: { ...process.env, AUTH_RETURN_BROWSER_CHILD_PROCESS: "1" },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    const outputTail = [stdout, stderr]
      .join("\n")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-30)
      .join("\n");
    throw new Error(
      `Isolated auth return browser suite failed with exit ${exitCode}:\n${outputTail}`
    );
  }
};

/**
 * Pre-fix wrapper behavior: runCase ran with no qualifying document-request
 * hold, no callback-loading landmark checks, and no capture. Used only as the
 * isolated RED baseline for the handoff review regression.
 */
const legacyCallbackHandoffReview = async (
  _page: Page,
  _baseUrl: string,
  runCase: () => Promise<void>
): Promise<void> => {
  await runCase();
};

if (!isBrowserSuiteChildProcess) {
  test("runs the real-browser auth return suite inside an isolated subprocess", async () => {
    await spawnIsolatedBrowserSuite();
  }, 180_000);
} else {
  describe("account auth return browser regression", () => {
    beforeAll(async () => {
      await createFixtureBundle();
      browser = await chromium.launch({ headless: true });
    });

    afterAll(async () => {
      await browser?.close();
      browser = undefined;
      if (fixtureDirectory) {
        await rm(fixtureDirectory, { force: true, recursive: true });
        fixtureDirectory = undefined;
      }
    });

    test("hands a verified link to the initiator and closes the script-opened callback tab", async () => {
      await runScenario("normal", async ({ context, server }) => {
        const initiator = await openInitiator(context, server);
        const link = await startMagicLink(
          initiator,
          server,
          fixtureEmail.verified
        );
        const callbackURL = callbackURLFromLink(link);
        const attempt = attemptFromCallbackURL(callbackURL);
        const callback = await openScriptCallback(context, initiator, link);

        await Promise.all([
          waitForAccount(initiator, server),
          waitForPageCloseObservation(callback, server.observations),
        ]);
        await waitUntil(
          "verified session read",
          () => server.observations.verifiedSessionResponses > 0
        );

        const events = server.observations.events;
        expect(
          server.observations.verificationCookieByAttempt.get(attempt)
        ).toBe(true);
        expect(server.observations.verificationResponsesWithSessionCookie).toBe(
          1
        );
        expect(server.observations.callbacksBeforeVerificationCookie).toBe(0);
        expect(
          server.observations.getSessionRequestsWithCookie
        ).toBeGreaterThan(0);
        expect(
          events.indexOf("verification-response-with-cookie")
        ).toBeLessThan(events.indexOf("callback-request"));
        expect(events.indexOf("callback-request")).toBeLessThan(
          events.indexOf("get-session-with-cookie")
        );
        expect(events.indexOf("get-session-verified")).toBeLessThan(
          events.indexOf("callback-tab-closed")
        );
        expect(initiator.url()).toBe(`${server.origin}${ACCOUNT_PATH}`);
        expect(callback.isClosed()).toBe(true);
      });
    });

    test("navigates a manually created callback tab when the browser blocks close", async () => {
      await runScenario("normal", async ({ context, server }) => {
        const initiator = await openInitiator(context, server);
        const link = await startMagicLink(
          initiator,
          server,
          fixtureEmail.verified
        );
        const callback = await context.newPage();

        await Promise.all([
          callback.goto(link.url, { waitUntil: "domcontentloaded" }),
          waitForAccount(initiator, server),
        ]);
        await waitForAccount(callback, server);

        expect(callback.isClosed()).toBe(false);
        expect(callback.url()).toBe(`${server.origin}${ACCOUNT_PATH}`);
        expect(server.observations.verificationResponsesWithSessionCookie).toBe(
          1
        );
        expect(server.observations.callbacksBeforeVerificationCookie).toBe(0);
      });
    });

    test.each([
      ["initiator absent", "normal", false, false, fixtureEmail.verified],
      ["stale session no-ack", "stale", true, false, fixtureEmail.noAck],
      [
        "unverified session",
        "unverified",
        false,
        false,
        fixtureEmail.unverified,
      ],
      ["invalid link", "normal", false, true, fixtureEmail.invalid],
    ] as const)(
      "%s never closes the callback tab before a verified handoff",
      async (_name, verificationMode, requireFreshSession, invalidLink, email) => {
        await runScenario(verificationMode, async ({ context, server }) => {
          const initiator = await openInitiator(context, server);
          const link = await startMagicLink(initiator, server, email, {
            requireFreshSession,
          });

          if (_name === "initiator absent") {
            await initiator.evaluate(() => {
              const fixture = window.__deskohubAuthReturnFixture;
              fixture.cancel();
            });
          }

          if (invalidLink) server.store.verification.length = 0;
          const callback = await openScriptCallback(context, initiator, link);

          await waitForAccount(callback, server);
          expect(callback.isClosed()).toBe(false);
          expect(callback.url()).toBe(`${server.origin}${ACCOUNT_PATH}`);

          if (
            _name === "initiator absent" ||
            _name === "stale session no-ack"
          ) {
            expect(initiator.url()).toBe(`${server.origin}/en-US/sign-in`);
          }
          if (_name === "unverified session") {
            await waitUntil(
              "unverified authoritative session read",
              () => server.observations.unverifiedSessionResponses > 0
            );
            expect(initiator.url()).toBe(`${server.origin}/en-US/sign-in`);
          }
          if (_name === "invalid link") {
            expect(
              server.observations.verificationResponsesWithSessionCookie
            ).toBe(0);
            expect(server.observations.getSessionRequestsWithCookie).toBe(0);
            expect(server.observations.callbacksBeforeVerificationCookie).toBe(
              1
            );
          }
        });
      }
    );

    test("replays a consumed link into an error callback without hijacking the pending attempt", async () => {
      await runScenario("normal", async ({ context, server }) => {
        const initiator = await openInitiator(context, server);
        const consumedLink = await startMagicLink(
          initiator,
          server,
          fixtureEmail.verified
        );
        const consumedAttempt = attemptFromCallbackURL(
          callbackURLFromLink(consumedLink)
        );
        const verifiedCallback = await openScriptCallback(
          context,
          initiator,
          consumedLink
        );
        await Promise.all([
          waitForAccount(initiator, server),
          waitForPageCloseObservation(verifiedCallback, server.observations),
        ]);
        const cookieSessionsAfterVerifiedHandoff =
          server.observations.getSessionRequestsWithCookie;
        expect(
          server.observations.verificationCookieByAttempt.get(consumedAttempt)
        ).toBe(true);

        await initiator.goto(`${server.origin}/en-US/sign-in`, {
          waitUntil: "domcontentloaded",
        });
        await initiator.getByRole("button", { name: "Open callback" }).waitFor({
          state: "visible",
        });
        const pendingLink = await startMagicLink(
          initiator,
          server,
          fixtureEmail.replayPending
        );
        const pendingAttempt = attemptFromCallbackURL(
          callbackURLFromLink(pendingLink)
        );
        expect(pendingAttempt).not.toBe(consumedAttempt);

        const replayCallback = await openScriptCallback(
          context,
          initiator,
          consumedLink
        );
        await waitForAccount(replayCallback, server);

        expect(server.observations.errorCallbacks).toEqual([consumedAttempt]);
        expect(replayCallback.isClosed()).toBe(false);
        expect(replayCallback.url()).toBe(`${server.origin}${ACCOUNT_PATH}`);
        expect(initiator.url()).toBe(`${server.origin}/en-US/sign-in`);
        expect(server.observations.getSessionRequestsWithCookie).toBe(
          cookieSessionsAfterVerifiedHandoff
        );
        expect(server.observations.verificationResponsesWithSessionCookie).toBe(
          1
        );
        expect(
          server.observations.verificationCookieByAttempt.has(pendingAttempt)
        ).toBe(false);
        expect(server.observations.callbacksBeforeVerificationCookie).toBe(1);
      });
    });

    const isLegacyHandoffStub =
      process.env.AUTH_RETURN_BROWSER_REGRESSION_STUB === "legacy-handoff";

    test("reviews the production callback handoff document without a live initiator", async () => {
      await runScenario("normal", async ({ context, server }) => {
        const initiator = await openInitiator(context, server);
        const link = await startMagicLink(
          initiator,
          server,
          fixtureEmail.review
        );
        expect(server.links).toHaveLength(1);

        const verifiedPage = await context.newPage();
        await verifiedPage.goto(new URL(link.url, server.origin).toString(), {
          waitUntil: "domcontentloaded",
        });
        await waitForAccount(verifiedPage, server);
        expect(server.observations.verificationLocationByAttempt.size).toBe(1);
        const [attempt, callbackLocation] = [
          ...server.observations.verificationLocationByAttempt,
        ][0]!;
        const callbackUrl = new URL(callbackLocation, server.origin);
        expect(callbackUrl.pathname).toBe(CALLBACK_PATH);
        expect(callbackUrl.searchParams.get("error")).toBeNull();
        expect(VALID_ATTEMPT_ID_PATTERN.test(attempt)).toBe(true);
        expect(
          server.observations.verificationCookieByAttempt.get(attempt)
        ).toBe(true);
        await verifiedPage.close();
        expect(initiator.url()).toBe(`${server.origin}${ACCOUNT_PATH}`);

        await rm(ACCOUNT_REVIEW_SCREENSHOT_PATH, { force: true });
        const getSessionRequestsBeforeReview =
          server.observations.getSessionRequests;
        try {
          if (isLegacyHandoffStub) {
            // RED baseline: the pre-fix wrapper ran the case with no hold,
            // no loading checks, and no capture.
            const page = await context.newPage();
            await legacyCallbackHandoffReview(page, server.origin, async () => {
              await page.goto(callbackUrl.toString(), {
                waitUntil: "domcontentloaded",
              });
              await page.waitForURL(`${server.origin}${ACCOUNT_PATH}`, {
                timeout: 25_000,
              });
            });
          } else {
            const page = await context.newPage();
            await withCallbackHandoffReview(page, server.origin, async () => {
              await page.goto(callbackUrl.toString(), {
                waitUntil: "domcontentloaded",
              });
              await page.waitForURL(`${server.origin}${ACCOUNT_PATH}`, {
                timeout: 25_000,
              });
            });
          }

          // The wrapper only persists the capture after the held qualifying
          // account document request passed the real loading checks, so the
          // PNG is the proof that navigation was held, reviewed, and forwarded.
          const screenshot = await Bun.file(
            ACCOUNT_REVIEW_SCREENSHOT_PATH
          ).bytes();
          expect(screenshot.byteLength).toBeGreaterThan(0);
          expect(
            Buffer.from(screenshot.slice(0, PNG_SIGNATURE.length)).equals(
              PNG_SIGNATURE
            )
          ).toBe(true);
          if (!fixtureDirectory) throw new Error("fixture dir is not ready");
          // The artifact directory and the fixture temp directory can live on
          // different filesystems, so copy instead of renaming across devices.
          await copyFile(
            ACCOUNT_REVIEW_SCREENSHOT_PATH,
            join(fixtureDirectory, ACCOUNT_REVIEW_SCREENSHOT_NAME)
          );

          expect(server.links).toHaveLength(1);
          expect(server.observations.getSessionRequests).toBe(
            getSessionRequestsBeforeReview
          );
          expect(server.observations.callbacksBeforeVerificationCookie).toBe(0);
        } finally {
          await rm(ACCOUNT_REVIEW_SCREENSHOT_PATH, { force: true });
          await rm(resolve(APP_ROOT, "e2e-artifacts/account-review"), {
            force: true,
          }).catch(() => undefined);
          await rm(resolve(APP_ROOT, "e2e-artifacts"), { force: true }).catch(
            () => undefined
          );
        }
      });
    });

    test("keeps different UUID attempts isolated across two initiator tabs", async () => {
      await runScenario("normal", async ({ context, server }) => {
        const firstInitiator = await openInitiator(context, server);
        const secondInitiator = await openInitiator(context, server);
        const firstLink = await startMagicLink(
          firstInitiator,
          server,
          fixtureEmail.isolatedFirst
        );
        const secondLink = await startMagicLink(
          secondInitiator,
          server,
          fixtureEmail.isolatedSecond
        );
        const firstAttempt = attemptFromCallbackURL(
          callbackURLFromLink(firstLink)
        );
        const secondAttempt = attemptFromCallbackURL(
          callbackURLFromLink(secondLink)
        );
        expect(firstAttempt).not.toBe(secondAttempt);

        const firstCallback = await openScriptCallback(
          context,
          firstInitiator,
          firstLink
        );
        await Promise.all([
          waitForAccount(firstInitiator, server),
          waitForPageCloseObservation(firstCallback, server.observations),
        ]);
        expect(secondInitiator.url()).toBe(`${server.origin}/en-US/sign-in`);
        expect(
          server.observations.verificationCookieByAttempt.get(firstAttempt)
        ).toBe(true);
        expect(
          server.observations.verificationCookieByAttempt.has(secondAttempt)
        ).toBe(false);

        const secondCallback = await openScriptCallback(
          context,
          secondInitiator,
          secondLink
        );
        await Promise.all([
          waitForAccount(secondInitiator, server),
          waitForPageCloseObservation(secondCallback, server.observations),
        ]);

        expect(
          server.observations.verificationCookieByAttempt.get(secondAttempt)
        ).toBe(true);
        expect(server.observations.callbacksBeforeVerificationCookie).toBe(0);
        expect(
          server.observations.getSessionRequestsWithCookie
        ).toBeGreaterThanOrEqual(2);
      });
    });
  });
}
