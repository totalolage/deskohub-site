import { afterAll, afterEach, beforeAll } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type BrowserContext,
  type BrowserContextOptions,
  chromium,
} from "@playwright/test";
import postcss from "postcss";
import loadPostCssConfig from "postcss-load-config";
import type { Locale } from "@/features/i18n";
import {
  allocateLoopbackPort,
  waitForOwnedLoopbackServer,
  waitForOwnedLoopbackServerToStop,
} from "@/shared/testing/loopback-server";

const fixtureParent = "/tmp/deskohub";
const accountFixtureReadyPath = "/en-US/account-legal-fixture-ready";
const appRoot = resolve(import.meta.dir, "..");
const globalsCssPath = resolve(appRoot, "app/globals.css");
export const accountFixtureAuthHeader = "x-deskohub-account-fixture";
const supportedLocales = [
  "en-US",
  "cs-CZ",
] as const satisfies readonly Locale[];

export type Viewport = {
  readonly width: number;
  readonly height: number;
};

type AccountLegalBrowser = Awaited<ReturnType<typeof chromium.launch>>;
export type AccountLegalFixture = {
  readonly browser: AccountLegalBrowser;
  readonly contexts: Set<BrowserContext>;
  readonly serverUrl: string;
  readonly close: () => Promise<void>;
};

const packageJson = JSON.stringify(
  {
    private: true,
    scripts: { dev: "next dev" },
    type: "module",
  },
  null,
  2
);

const nextConfig = `
const nextConfig = {
  cacheComponents: true,
  cacheLife: {
    publicContent: { stale: 30, revalidate: 60, expire: 300 },
  },
  experimental: {
    instantInsights: {
      validationLevel: "manual-warning",
    },
  },
  partialPrefetching: true,
};

export default nextConfig;
`;

const localeLayout = (realCookieConsent: boolean) => `
import type { ReactNode } from "react";
import { FixtureHydration } from "@/fixture/hydration";
${
  realCookieConsent
    ? 'import { CookieConsentProvider } from "@/features/cookie-consent/components/cookie-consent-provider";\n'
    : ""
}import { UnsavedChangesProvider } from "@/shared/components/unsaved-changes-guard";
import "../globals.css";

export const instant = false;

export function generateStaticParams() {
  return [{ locale: "en-US" }, { locale: "cs-CZ" }];
}

type LocaleLayoutProps = {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
${
  realCookieConsent ? "        <CookieConsentProvider locale={locale} />\n" : ""
}        <UnsavedChangesProvider>
          <FixtureHydration>{children}</FixtureHydration>
        </UnsavedChangesProvider>
      </body>
    </html>
  );
}
`;

const syntheticConsentWaypointPage = `
import Link from "next/link";

export default function ConsentWaypointPage() {
  return (
    <main className="flex flex-col gap-4 px-6 pb-16 pt-40">
      <h1>Synthetic consent waypoint</h1>
      <p>Synthetic public navigation waypoint with no duplicated account UI.</p>
      <Link href="/en-US/account/legal">Back to public legal</Link>
    </main>
  );
}
`;

const fixtureSiteHeaderConfig = (contactHrefExpression: string) => `
import { isCustomerSignedIn } from "@/features/account/server/customer-session.server";
import type { Locale } from "@/features/i18n";

export type SiteHeaderAccountEntry = {
  readonly label: string;
  readonly href: Promise<string>;
  readonly signInHref: string;
};

export type SiteHeaderMenuItemId =
  | "locationMap"
  | "meetingRoom"
  | "office"
  | "gallery"
  | "founders"
  | "faqContact"
  | "contact";

export type SiteHeaderMenuItem = {
  readonly id: SiteHeaderMenuItemId;
  readonly label: string;
  readonly href: string;
};

export async function getSiteHeaderConfig(locale: Locale) {
  const localePath = "/" + locale;
  const links: SiteHeaderMenuItem[] = [
    {
      id: "locationMap",
      label: "Location",
      href: localePath + "#location-map",
    },
    {
      id: "meetingRoom",
      label: "Meeting room",
      href: localePath + "/meeting-room",
    },
    {
      id: "gallery",
      label: "Gallery",
      href: localePath + "/gallery",
    },
  ];

  return {
    account: {
      label: "Account",
      href: isCustomerSignedIn()
        .catch(() => false)
        .then((signedIn) =>
          signedIn ? localePath + "/account" : localePath + "/auth/sign-in"
        ),
      signInHref: localePath + "/auth/sign-in",
    } satisfies SiteHeaderAccountEntry,
    closeNavigationMenuLabel: "Close navigation menu",
    contactHref: ${contactHrefExpression},
    contactLabel: "Contact",
    languageLabels: {
      "cs-CZ": "Čeština",
      "en-US": "English",
    } satisfies Record<Locale, string>,
    languageSwitcherLabel: "Language",
    links,
    mobilePrimaryNavigationLabel: "Mobile primary navigation",
    openNavigationMenuLabel: "Open navigation menu",
    primaryNavigationLabel: "Primary navigation",
  };
}
`;

const fixtureAuthentication = `
import { Context, Effect, Layer } from "effect";
import { headers } from "next/headers";

type FixtureUser = {
  readonly fixture: true;
};

interface FixtureAuthentication {
  readonly currentUser: Effect.Effect<FixtureUser | null>;
}

export class CustomerAuthentication extends Context.Service<
  CustomerAuthentication,
  FixtureAuthentication
>()("@deskohub-workspace/account/CustomerAuthentication") {
  static Default = Layer.succeed(this, {
    currentUser: Effect.promise(async () => {
      const requestHeaders = await headers();
      return requestHeaders.get("x-deskohub-account-fixture") === "private"
        ? { fixture: true }
        : null;
    }),
  });
}
`;

const fixtureAccountFeatureFlag = `
// The legal fixture has no Sign-in & security section, so passkeys stay off.
export async function arePasskeysEnabled(): Promise<boolean> {
  return false;
}
`;

// The account layout reads the referral flag; the legal fixture has no
// referral section, so it runs as a deployment with the program withheld.
const fixtureReferralFeatureFlag = `
export async function areReferralsEnabled(): Promise<boolean> {
  return false;
}
`;

const fixtureMarketingPreferences = `
import type { Locale } from "@/features/i18n";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";

export async function getMarketingPreferences(
  _locale: Locale
): Promise<MarketingPreferencesState> {
  return { status: "unavailable" };
}
`;

const fixtureMarketingActionError =
  "Unavailable in account continuity fixture: backend action was not executed.";

const fixtureMarketingActions = `
"use server";

type UnavailableActionResult = {
  readonly serverError: string;
};

const unavailableMessage = "${fixtureMarketingActionError}";

export async function saveMarketingPreferencesAction(
  _input: unknown
): Promise<UnavailableActionResult> {
  return { serverError: unavailableMessage };
}

export async function confirmMarketingManagementAction(
  _input: unknown
): Promise<UnavailableActionResult> {
  return { serverError: unavailableMessage };
}

export async function clearMarketingManagementAction(
  _input: unknown
): Promise<UnavailableActionResult> {
  return { serverError: unavailableMessage };
}
`;

const fixtureWorkspaceEffect = `
import { Effect } from "effect";

export const runWorkspaceEffect =
  (_name: string, _options?: unknown) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(effect as Effect.Effect<A, never, never>);
`;

const fixtureEnv = `
export const env = {
  NEXT_PUBLIC_POSTHOG_HOST: undefined,
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: undefined,
} as const;
`;

const fixtureCookieConsent = `
export type ConsentCategory = "necessary" | "analytics" | "marketing" | "preferences";

export function useCookieConsent() {
  return {
    acceptAll: () => undefined,
    acceptCategory: (_category: ConsentCategory) => undefined,
    isAccepted: (_category: ConsentCategory) => false,
    rejectAll: () => undefined,
    rejectCategory: (_category: ConsentCategory) => undefined,
  };
}
`;

const fixtureHydration = `
"use client";

import { type ReactNode, useEffect } from "react";

export function FixtureHydration({ children }: { readonly children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.fixtureHydrated = "true";
  }, []);

  return children;
}
`;

// The real sections' layout and pages render the account page through these
// stand-ins: synthetic private content for the fixture's signed-in requests,
// and the real redirect to sign-in for signed-out ones.
const fixtureAccountPageData = `
import { headers } from "next/headers";

export async function loadCustomerAccountPage() {
  const requestHeaders = await headers();
  return requestHeaders.get("${accountFixtureAuthHeader}") === "private"
    ? { kind: "fixture" as const }
    : { kind: "unauthenticated" as const };
}
`;

const fixtureAccountPage = `
import { AccountSignInRedirect } from "@/features/account/components/account-sign-in-redirect";
import type { Locale } from "@/features/i18n";
import { FixtureAccountDraft } from "./account-draft";

export function AccountPage({
  locale,
  state,
}: {
  readonly locale: Locale;
  readonly state: { readonly kind: "fixture" | "unauthenticated" };
}) {
  if (state.kind === "unauthenticated") {
    return <AccountSignInRedirect locale={locale} />;
  }

  return (
    <section data-testid="synthetic-private-content" aria-labelledby="synthetic-private-title">
      <h2 id="synthetic-private-title">Synthetic private profile</h2>
      <p>Private page data is synthetic and provider-independent.</p>
      <FixtureAccountDraft locale={locale} />
    </section>
  );
}
`;

// Client state that must survive a revalidating Server Action after an
// in-place section switch, as the account deletion dialog does through its
// reauthentication step.
const fixtureAccountDraft = `
"use client";

import { useState, useTransition } from "react";
import type { Locale } from "@/features/i18n";
import { revalidateFixtureAccount } from "./account-actions";

export function FixtureAccountDraft({ locale }: { readonly locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [revalidations, setRevalidations] = useState(0);
  const [, startTransition] = useTransition();

  return (
    <div>
      <button type="button" data-testid="fixture-draft-open" onClick={() => setOpen(true)}>
        Open draft
      </button>
      {open && (
        <div data-testid="fixture-draft">
          <button
            type="button"
            data-testid="fixture-draft-revalidate"
            onClick={() =>
              startTransition(async () => {
                await revalidateFixtureAccount(locale);
                setRevalidations((count) => count + 1);
              })
            }
          >
            Revalidate
          </button>
          <output data-testid="fixture-draft-revalidations">{revalidations}</output>
        </div>
      )}
    </div>
  );
}
`;

// Revalidates like account deletion's stale-session reauthentication.
const fixtureAccountActions = `
"use server";

import { revalidatePath } from "next/cache";
import { getAccountPath } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";

export async function revalidateFixtureAccount(locale: Locale) {
  revalidatePath(getAccountPath(locale), "layout");
}
`;

// Hands account renders their pathname, as the Workspace proxy does, for the
// sections' layout's section check.
const fixtureProxy = `
import { type NextRequest, NextResponse } from "next/server";
import { withRequestPathname } from "@/shared/backend/utils/request-pathname";

export function proxy(request: NextRequest) {
  return NextResponse.next({
    request: { headers: withRequestPathname(request) },
  });
}

export const config = { matcher: ["/:locale/account", "/:locale/account/:path*"] };
`;

const fixtureReadinessRoute = (marker: string) => `
export async function GET() {
  return new Response(${JSON.stringify(marker)}, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
`;

type AccountLegalFixtureOptions = {
  readonly realCookieConsent?: boolean;
};

const writeFixture = async (
  fixtureRoot: string,
  {
    readinessMarker,
    realCookieConsent = false,
  }: AccountLegalFixtureOptions & { readonly readinessMarker: string }
) => {
  const fixtureFiles: Readonly<Record<string, string>> = {
    "app/[locale]/account-legal-fixture-ready/route.ts":
      fixtureReadinessRoute(readinessMarker),
    ...(realCookieConsent
      ? {
          "app/[locale]/(site)/(full-header)/consent-waypoint/page.tsx":
            syntheticConsentWaypointPage,
        }
      : {}),
    "app/[locale]/layout.tsx": localeLayout(realCookieConsent),
    "fixture/account-feature-flag.server.ts": fixtureAccountFeatureFlag,
    "fixture/account-actions.ts": fixtureAccountActions,
    "fixture/account-draft.tsx": fixtureAccountDraft,
    "fixture/account-page.tsx": fixtureAccountPage,
    "fixture/account-page-data.server.ts": fixtureAccountPageData,
    "fixture/customer-authentication.service.ts": fixtureAuthentication,
    ...(realCookieConsent
      ? {}
      : { "fixture/cookie-consent.ts": fixtureCookieConsent }),
    "fixture/env.ts": fixtureEnv,
    "fixture/hydration.tsx": fixtureHydration,
    "fixture/marketing-actions.ts": fixtureMarketingActions,
    "fixture/marketing-preferences.server.ts": fixtureMarketingPreferences,
    "fixture/referral-feature-flag.server.ts": fixtureReferralFeatureFlag,
    "fixture/site-header-config.ts": fixtureSiteHeaderConfig(
      realCookieConsent
        ? 'localePath + "/consent-waypoint"'
        : 'localePath + "/contact"'
    ),
    "fixture/workspace-effect.ts": fixtureWorkspaceEffect,
    "instrumentation.ts": "export function register() {}",
    "next.config.mjs": nextConfig,
    "proxy.ts": fixtureProxy,
    "package.json": packageJson,
  };

  for (const [relativePath, contents] of Object.entries(fixtureFiles)) {
    const filePath = join(fixtureRoot, relativePath);
    await mkdir(resolve(filePath, ".."), { recursive: true });
    if (contents) await writeFile(filePath, contents);
  }

  const tsconfig = {
    compilerOptions: {
      allowJs: true,
      baseUrl: ".",
      esModuleInterop: true,
      isolatedModules: true,
      jsx: "preserve",
      lib: ["dom", "dom.iterable", "esnext"],
      module: "esnext",
      moduleResolution: "bundler",
      noEmit: true,
      paths: {
        "@/features/account/server/account-feature-flag.server": [
          "./fixture/account-feature-flag.server.ts",
        ],
        "@/features/account/components/account-page": [
          "./fixture/account-page.tsx",
        ],
        "@/features/account/page-data.server": [
          "./fixture/account-page-data.server.ts",
        ],
        "@/features/account/backend/customer-authentication.service": [
          "./fixture/customer-authentication.service.ts",
        ],
        "@/env": ["./fixture/env.ts"],
        ...(realCookieConsent
          ? {}
          : { "@/features/cookie-consent": ["./fixture/cookie-consent.ts"] }),
        "@/features/legal/marketing-preferences.server": [
          "./fixture/marketing-preferences.server.ts",
        ],
        "@/features/legal/actions": ["./fixture/marketing-actions.ts"],
        "@/features/referrals/referral-feature-flag.server": [
          "./fixture/referral-feature-flag.server.ts",
        ],
        "@/shared/backend/workspace-effect": ["./fixture/workspace-effect.ts"],
        "@/shared/components/site-header-config": [
          "./fixture/site-header-config.ts",
        ],
        "@/*": ["./*"],
      },
      plugins: [{ name: "next" }],
      resolveJsonModule: true,
      skipLibCheck: true,
      strict: true,
      target: "ES2017",
    },
  };
  await writeFile(join(fixtureRoot, "tsconfig.json"), JSON.stringify(tsconfig));

  for (const relativePath of [
    "app/[locale]/(site)/(full-header)/account/layout.tsx",
    "app/[locale]/(site)/(full-header)/account/@modal/default.tsx",
    "app/[locale]/(site)/(full-header)/account/@modal/page.tsx",
    "app/[locale]/(site)/(full-header)/account/@modal/[section]/page.tsx",
    "app/[locale]/(site)/(full-header)/account/(sections)/layout.tsx",
    "app/[locale]/(site)/(full-header)/account/(sections)/page.tsx",
    "app/[locale]/(site)/(full-header)/account/(sections)/[section]/page.tsx",
    "app/[locale]/(site)/(full-header)/account/loading.tsx",
    "app/[locale]/(site)/(full-header)/account/legal/page.tsx",
    "app/[locale]/(site)/(full-header)/layout.tsx",
  ]) {
    const destination = join(fixtureRoot, relativePath);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await copyFile(join(appRoot, relativePath), destination);
  }

  const postCssConfig = await loadPostCssConfig({}, appRoot);
  const globalsCss = await readFile(globalsCssPath, "utf8");
  const compiledGlobalsCss = await postcss(postCssConfig.plugins).process(
    globalsCss,
    { from: globalsCssPath }
  );
  const compiledGlobalsDestination = join(fixtureRoot, "app/globals.css");
  await mkdir(resolve(compiledGlobalsDestination, ".."), { recursive: true });
  await writeFile(compiledGlobalsDestination, compiledGlobalsCss.css);

  await symlink(join(appRoot, "assets"), join(fixtureRoot, "assets"), "dir");
  await symlink(
    join(appRoot, "features"),
    join(fixtureRoot, "features"),
    "dir"
  );
  await symlink(
    join(appRoot, "node_modules"),
    join(fixtureRoot, "node_modules"),
    "dir"
  );
  await symlink(join(appRoot, "shared"), join(fixtureRoot, "shared"), "dir");
};

const warmFixtureRoutes = async (
  serverUrl: string,
  extraRoutes: readonly string[] = []
) => {
  for (const locale of supportedLocales) {
    for (const route of [
      `/${locale}/account/profile`,
      `/${locale}/account/legal`,
      ...extraRoutes,
    ]) {
      const response = await fetch(`${serverUrl}${route}`, {
        headers: { [accountFixtureAuthHeader]: "private" },
      });
      if (!response.ok) {
        throw new Error("account legal fixture route failed during warmup");
      }
      await response.arrayBuffer();
    }
  }
};

export const openFixtureContext = async (
  fixture: AccountLegalFixture,
  options: BrowserContextOptions
) => {
  const context = await fixture.browser.newContext(options);
  fixture.contexts.add(context);
  return context;
};

export const closeFixtureContext = async (
  fixture: AccountLegalFixture,
  context: BrowserContext
) => {
  fixture.contexts.delete(context);
  await context.close();
};

const closeRemainingFixtureContexts = async (contexts: Set<BrowserContext>) => {
  const remainingContexts = [...contexts];
  contexts.clear();
  await Promise.allSettled(remainingContexts.map((context) => context.close()));
};

const accountFixtureStartupTimeout = 180_000;
export const accountFixtureCaseTimeout = 90_000;

const startAccountLegalFixture = async ({
  realCookieConsent = false,
}: AccountLegalFixtureOptions = {}): Promise<AccountLegalFixture> => {
  const port = await allocateLoopbackPort();
  const readinessMarker = randomUUID();
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(
    join(fixtureParent, "deskohub-account-legal-")
  );
  const serverUrl = `http://localhost:${port}`;
  const readyUrl = `${serverUrl}${accountFixtureReadyPath}`;
  const processExit = {
    complete: false,
    code: undefined as number | undefined,
  };
  const contexts = new Set<BrowserContext>();
  let server: ReturnType<typeof Bun.spawn> | undefined;
  let serverExit: Promise<number> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let serverReady = false;
  let closePromise: Promise<void> | undefined;

  const close = async () => {
    if (closePromise !== undefined) return closePromise;

    closePromise = (async () => {
      await closeRemainingFixtureContexts(contexts);
      try {
        await browser?.close();
      } catch {
        // Cleanup must continue if a failed test already closed the browser.
      }

      try {
        if (server) {
          if (!processExit.complete) server.kill();
          await serverExit;
          if (serverReady)
            await waitForOwnedLoopbackServerToStop({
              marker: readinessMarker,
              readyUrl,
              timeoutMs: 5_000,
            });
        }
      } finally {
        await rm(fixtureRoot, { force: true, recursive: true });
      }
    })();

    return closePromise;
  };

  try {
    await writeFixture(fixtureRoot, { readinessMarker, realCookieConsent });
    const nextCli = resolve(appRoot, "node_modules/next/dist/bin/next");
    server = Bun.spawn(
      [
        "node",
        nextCli,
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: fixtureRoot,
        env: {
          HOME: process.env.HOME ?? "/tmp",
          NEXT_TELEMETRY_DISABLED: "1",
          PATH: process.env.PATH ?? "",
        },
        stderr: "inherit",
        stdout: "inherit",
      }
    );
    serverExit = server.exited.then((code) => {
      processExit.code = code;
      processExit.complete = true;
      return code;
    });

    await waitForOwnedLoopbackServer({
      exitCode: () => (processExit.complete ? processExit.code : undefined),
      marker: readinessMarker,
      pollIntervalMs: 250,
      readyUrl,
      timeoutMs: accountFixtureStartupTimeout,
    });
    serverReady = true;
    await warmFixtureRoutes(
      serverUrl,
      realCookieConsent
        ? supportedLocales.map((locale) => `/${locale}/consent-waypoint`)
        : []
    );
    const launchedBrowser = await chromium.launch({ headless: true });
    browser = launchedBrowser;

    return {
      browser: launchedBrowser,
      close,
      contexts,
      serverUrl,
    };
  } catch (error) {
    await close();
    throw error;
  }
};

const requireFixture = (fixture: AccountLegalFixture | undefined) => {
  if (fixture === undefined) {
    throw new Error("account legal fixture did not start");
  }
  return fixture;
};

/**
 * Starts one account legal fixture for the enclosing describe block, closes
 * browser contexts a test left open, and returns an accessor for the started
 * fixture. Each fixture allocates its own loopback dev server port.
 */
export const registerAccountLegalFixture = (
  options: AccountLegalFixtureOptions = {}
) => {
  let fixture: AccountLegalFixture | undefined;

  beforeAll(async () => {
    fixture = await startAccountLegalFixture(options);
  }, accountFixtureStartupTimeout);

  afterEach(async () => {
    if (fixture) await closeRemainingFixtureContexts(fixture.contexts);
  });

  afterAll(async () => {
    const currentFixture = fixture;
    fixture = undefined;
    await currentFixture?.close();
  });

  return () => requireFixture(fixture);
};
