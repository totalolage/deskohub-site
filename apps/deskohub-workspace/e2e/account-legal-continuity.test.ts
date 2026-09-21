import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
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
  expect as expectLocator,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import postcss from "postcss";
import loadPostCssConfig from "postcss-load-config";
import { type Locale, m } from "@/features/i18n";
import { marketingPreferencesFormCopy } from "@/features/legal/components/marketing-preferences-form.copy";
import {
  type CookieCategory,
  expectNoAuthSessionCookie,
  expectPublicAccountLegal,
  preparePublicLegalBrowser,
  waitForCookieSwitchHandler,
} from "./instant-navigation/public-account-legal-assertions";
import { dismissLegalCookieConsent } from "./legal-cookie-consent";

const accountLegalPort = 3168;
const fixtureParent = "/tmp/opencode";
const appRoot = resolve(import.meta.dir, "..");
const globalsCssPath = resolve(appRoot, "app/globals.css");
const siteHeaderSelector = "body > header";
const accountHeaderSelector = "main > div > header";
const accountNavigationSelector = "main aside > nav";
const accountContentLoadingSelector = '[data-slot="account-content-loading"]';
const accountFixtureAuthHeader = "x-deskohub-account-fixture";
const accountFixtureRolloutHeader = "x-deskohub-account-rollout";
const accountFixtureMarketingLinkHeader = "x-deskohub-marketing-link";
const accountFixtureRolloutOffValue = "off";
const accountFixtureMarketingLinkValue = "pending";
const supportedLocales = [
  "en-US",
  "cs-CZ",
] as const satisfies readonly Locale[];
const viewports = [
  { height: 900, name: "mobile 320", width: 320 },
  { height: 900, name: "mobile 375", width: 375 },
  { height: 900, name: "mobile 480", width: 480 },
  { height: 900, name: "desktop", width: 1440 },
] as const;

const accountDesktopBreakpoint = 768;

type Viewport = {
  readonly width: number;
  readonly height: number;
};

type Geometry = {
  readonly bottom: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

type ShellGeometry = {
  readonly header: Geometry;
  readonly navigation: Geometry;
};

type ContinuityObservation = ShellGeometry & {
  readonly siteHeaderComputedHeight: string;
  readonly siteHeaderConnected: boolean;
  readonly siteHeaderCount: number;
  readonly siteHeaderSame: boolean;
  readonly siteHeaderPosition: string;
  readonly siteHeaderRectHeight: number;
  readonly siteHeaderWidth: number;
  readonly siteHeaderZIndex: string;
  readonly headerConnected: boolean;
  readonly headerCount: number;
  readonly headerSame: boolean;
  readonly navigationConnected: boolean;
  readonly navigationCount: number;
  readonly navigationSame: boolean;
};

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
};

type HeldRscNavigation = {
  readonly dispose: () => Promise<void>;
  readonly release: () => Promise<void>;
  readonly waitForIntercept: () => Promise<void>;
};

type AccountLegalBrowser = Awaited<ReturnType<typeof chromium.launch>>;
type AccountLegalFixture = {
  readonly browser: AccountLegalBrowser;
  readonly contexts: Set<BrowserContext>;
  readonly serverUrl: string;
  readonly close: () => Promise<void>;
};

const makeDeferred = <T>(): Deferred<T> => {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
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
import type { Locale } from "@/features/i18n";

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
    accountHref: localePath + "/account",
    accountLabel: "Account",
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
import { headers } from "next/headers";

export async function areAccountsEnabled(): Promise<boolean> {
  const requestHeaders = await headers();
  return requestHeaders.get("${accountFixtureRolloutHeader}") !== "${accountFixtureRolloutOffValue}";
}
`;

const fixtureMarketingPreferences = `
import { headers } from "next/headers";
import type { Locale } from "@/features/i18n";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";

export async function getMarketingPreferences(
  _locale: Locale
): Promise<MarketingPreferencesState> {
  const requestHeaders = await headers();
  if (
    requestHeaders.get("${accountFixtureMarketingLinkHeader}") !==
    "${accountFixtureMarketingLinkValue}"
  ) {
    return { status: "unavailable" };
  }

  return {
    context: "synthetic-marketing-management-context",
    dismissalContext: "synthetic-marketing-management-dismissal-context",
    status: "pending-link",
  };
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

const fixtureMarketingActionExports = [
  "saveMarketingPreferencesAction",
  "confirmMarketingManagementAction",
  "clearMarketingManagementAction",
] as const;

test("keeps fixture marketing actions synthetic and fail closed", () => {
  expect(fixtureMarketingActions).toContain('"use server";');
  expect(fixtureMarketingActions).toContain(fixtureMarketingActionError);
  expect(fixtureMarketingActions).not.toMatch(/^\s*import\s/m);

  for (const actionName of fixtureMarketingActionExports) {
    expect(fixtureMarketingActions).toContain(
      `export async function ${actionName}`
    );
  }
});

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

const privatePage = `
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountContentLoading } from "@/features/account/components/account-loading";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export default function SyntheticPrivateAccountPage() {
  return runWithRequestLocale((locale) => (
    <Suspense fallback={<AccountContentLoading locale={locale} />}>
      <SyntheticPrivateContent />
    </Suspense>
  ));
}

async function SyntheticPrivateContent() {
  await connection();
  await headers();

  return (
    <section data-testid="synthetic-private-content" aria-labelledby="synthetic-private-title">
      <h2 id="synthetic-private-title">Synthetic private profile</h2>
      <p>Private page data is synthetic and provider-independent.</p>
    </section>
  );
}
`;

const nullModalPage = `
export default function AccountModal() {
  return null;
}
`;

type AccountLegalFixtureOptions = {
  readonly realCookieConsent?: boolean;
};

const writeFixture = async (
  fixtureRoot: string,
  { realCookieConsent = false }: AccountLegalFixtureOptions = {}
) => {
  const fixtureFiles: Readonly<Record<string, string>> = {
    "app/[locale]/(full-header)/account/@modal/default.tsx": nullModalPage,
    "app/[locale]/(full-header)/account/@modal/page.tsx": nullModalPage,
    "app/[locale]/(full-header)/account/@modal/[...not-found]/page.tsx":
      nullModalPage,
    "app/[locale]/(full-header)/account/page.tsx": privatePage,
    ...(realCookieConsent
      ? {
          "app/[locale]/(full-header)/consent-waypoint/page.tsx":
            syntheticConsentWaypointPage,
        }
      : {}),
    "app/[locale]/layout.tsx": localeLayout(realCookieConsent),
    "fixture/account-feature-flag.server.ts": fixtureAccountFeatureFlag,
    "fixture/customer-authentication.service.ts": fixtureAuthentication,
    ...(realCookieConsent
      ? {}
      : { "fixture/cookie-consent.ts": fixtureCookieConsent }),
    "fixture/env.ts": fixtureEnv,
    "fixture/hydration.tsx": fixtureHydration,
    "fixture/marketing-actions.ts": fixtureMarketingActions,
    "fixture/marketing-preferences.server.ts": fixtureMarketingPreferences,
    "fixture/site-header-config.ts": fixtureSiteHeaderConfig(
      realCookieConsent
        ? 'localePath + "/consent-waypoint"'
        : 'localePath + "/contact"'
    ),
    "fixture/workspace-effect.ts": fixtureWorkspaceEffect,
    "instrumentation.ts": "export function register() {}",
    "next.config.mjs": nextConfig,
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
    "app/[locale]/(full-header)/account/layout.tsx",
    "app/[locale]/(full-header)/account/loading.tsx",
    "app/[locale]/(full-header)/account/legal/page.tsx",
    "app/[locale]/(full-header)/layout.tsx",
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

const waitForServer = async (
  url: string,
  exited: { value: boolean },
  timeoutMs = 20_000
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited.value)
      throw new Error("account legal fixture server exited early");
    try {
      const response = await fetch(url, {
        headers: { [accountFixtureAuthHeader]: "private" },
      });
      if (response.status < 500) return;
    } catch {
      // The Next development server is still compiling or binding its port.
    }
    await Bun.sleep(100);
  }
  throw new Error("account legal fixture server did not become ready");
};

const waitForServerToStop = async (url: string) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error("account legal fixture server did not release its port");
};

const warmFixtureRoutes = async (
  serverUrl: string,
  extraRoutes: readonly string[] = []
) => {
  for (const locale of supportedLocales) {
    for (const route of [
      `/${locale}/account?section=profile`,
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

const readGeometry = async (page: Page): Promise<ShellGeometry> =>
  page.evaluate(() => {
    const geometryOf = (selector: string): Geometry => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`fixture selector did not resolve: ${selector}`);
      }
      const { bottom, height, left, right, top, width, x, y } =
        element.getBoundingClientRect();
      return { bottom, height, left, right, top, width, x, y };
    };

    return {
      header: geometryOf("main > div > header"),
      navigation: geometryOf("main aside > nav"),
    };
  });

const captureShellReferences = async (page: Page) =>
  page.evaluate(() => {
    const siteHeader = document.querySelector("body > header");
    const header = document.querySelector("main > div > header");
    const navigation = document.querySelector("main aside > nav");
    if (
      !(siteHeader instanceof HTMLElement) ||
      !(header instanceof HTMLElement) ||
      !(navigation instanceof HTMLElement)
    ) {
      throw new Error(
        "production site and account shell references were not rendered"
      );
    }

    const browserWindow = window as Window & {
      __deskohubAccountContinuity?: {
        readonly siteHeader: HTMLElement;
        readonly header: HTMLElement;
        readonly navigation: HTMLElement;
      };
    };
    browserWindow.__deskohubAccountContinuity = {
      header,
      navigation,
      siteHeader,
    };
  });

const inspectShellContinuity = async (
  page: Page
): Promise<ContinuityObservation> =>
  page.evaluate(() => {
    const browserWindow = window as Window & {
      __deskohubAccountContinuity?: {
        readonly siteHeader: HTMLElement;
        readonly header: HTMLElement;
        readonly navigation: HTMLElement;
      };
    };
    const stored = browserWindow.__deskohubAccountContinuity;
    const currentSiteHeader = document.querySelector("body > header");
    const currentHeader = document.querySelector("main > div > header");
    const currentNavigation = document.querySelector("main aside > nav");
    if (!(currentSiteHeader instanceof HTMLElement)) {
      throw new Error("global site header disappeared during navigation");
    }
    if (!(currentHeader instanceof HTMLElement)) {
      throw new Error("account header disappeared during navigation");
    }
    if (!(currentNavigation instanceof HTMLElement)) {
      throw new Error("account navigation disappeared during navigation");
    }
    if (!stored) throw new Error("account shell references were not captured");

    const siteHeaderStyle = getComputedStyle(currentSiteHeader);
    const siteHeaderRect = currentSiteHeader.getBoundingClientRect();
    const geometryOf = (element: HTMLElement): Geometry => {
      const { bottom, height, left, right, top, width, x, y } =
        element.getBoundingClientRect();
      return { bottom, height, left, right, top, width, x, y };
    };

    return {
      header: geometryOf(currentHeader),
      headerConnected: stored.header.isConnected,
      headerCount: document.querySelectorAll("main > div > header").length,
      headerSame: stored.header === currentHeader,
      navigation: geometryOf(currentNavigation),
      navigationConnected: stored.navigation.isConnected,
      navigationCount: document.querySelectorAll("main aside > nav").length,
      navigationSame: stored.navigation === currentNavigation,
      siteHeaderComputedHeight: siteHeaderStyle.height,
      siteHeaderConnected: stored.siteHeader.isConnected,
      siteHeaderCount: document.querySelectorAll("body > header").length,
      siteHeaderPosition: siteHeaderStyle.position,
      siteHeaderRectHeight: siteHeaderRect.height,
      siteHeaderSame: stored.siteHeader === currentSiteHeader,
      siteHeaderWidth: siteHeaderRect.width,
      siteHeaderZIndex: siteHeaderStyle.zIndex,
    };
  });

const assertShellContinuity = (
  observation: ContinuityObservation,
  expectedGeometry: ShellGeometry
) => {
  expect(observation.siteHeaderComputedHeight).toBe("96px");
  expect(observation.siteHeaderConnected).toBe(true);
  expect(observation.siteHeaderSame).toBe(true);
  expect(observation.siteHeaderCount).toBe(1);
  expect(observation.siteHeaderPosition).toBe("fixed");
  expect(Math.abs(observation.siteHeaderRectHeight - 96)).toBeLessThanOrEqual(
    1
  );
  expect(observation.siteHeaderWidth).toBeGreaterThan(0);
  expect(observation.siteHeaderZIndex).toBe("50");
  expect(observation.headerConnected).toBe(true);
  expect(observation.navigationConnected).toBe(true);
  expect(observation.headerSame).toBe(true);
  expect(observation.navigationSame).toBe(true);
  expect(observation.headerCount).toBe(1);
  expect(observation.navigationCount).toBe(1);
  expect(observation.header).toEqual(expectedGeometry.header);
  expect(observation.navigation).toEqual(expectedGeometry.navigation);
};

const isTargetRscRequest = (
  route: Route,
  expectedPathname: string,
  expectedSection: string | undefined
) => {
  const request = route.request();
  const requestHeaders = request.headers();
  if (requestHeaders.rsc !== "1") return false;
  if (
    requestHeaders["next-router-prefetch"] === "1" ||
    requestHeaders.purpose === "prefetch" ||
    requestHeaders["sec-purpose"] === "prefetch"
  ) {
    return false;
  }

  const url = new URL(request.url());
  if (url.pathname !== expectedPathname) return false;
  return expectedSection === undefined
    ? url.searchParams.get("section") === null
    : url.searchParams.get("section") === expectedSection;
};

const holdRscNavigation = async (
  page: Page,
  expectedPathname: string,
  expectedSection: string | undefined
): Promise<HeldRscNavigation> => {
  const intercepted = makeDeferred<void>();
  const release = makeDeferred<void>();
  const pending = new Set<Promise<void>>();
  const routePattern = "**/*";

  const handler = async (route: Route) => {
    if (!isTargetRscRequest(route, expectedPathname, expectedSection)) {
      await route.continue();
      return;
    }

    const responseWork = (async () => {
      try {
        intercepted.resolve();
        const response = await route.fetch();
        await release.promise;
        await route.fulfill({ response });
      } catch (error) {
        intercepted.reject(error);
        await route.abort().catch(() => undefined);
      }
    })();
    pending.add(responseWork);
    await responseWork;
    pending.delete(responseWork);
  };

  await page.route(routePattern, handler);

  return {
    dispose: async () => {
      release.resolve();
      await page.unroute(routePattern, handler);
      await Promise.allSettled([...pending]);
    },
    release: async () => {
      release.resolve();
    },
    waitForIntercept: async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          intercepted.promise,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(new Error("expected RSC request was not intercepted")),
              15_000
            );
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
};

const waitForAccountSectionButtonHandler = async (
  page: Page,
  button: Locator
) => {
  const element = await button.elementHandle();
  if (element === null)
    throw new Error("account section button was not rendered");

  try {
    await page.waitForFunction(hasReactClickHandler, element, {
      timeout: 15_000,
    });
  } finally {
    await element.dispose();
  }
};

function hasReactClickHandler(element: Element | null): boolean {
  if (element === null) return false;
  const reactPropsKey = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$")
  );
  if (reactPropsKey === undefined) return false;

  const reactProps = Object.getOwnPropertyDescriptor(
    element,
    reactPropsKey
  )?.value;
  if (typeof reactProps !== "object" || reactProps === null) return false;

  return (
    "onClick" in reactProps &&
    typeof (reactProps as { readonly onClick?: unknown }).onClick === "function"
  );
}

const accountSectionLabels = (locale: Locale) => ({
  billing: m.accountSectionBilling({}, { locale }),
  danger: m.accountSectionDanger({}, { locale }),
  legal: m.accountSectionLegal({}, { locale }),
  profile: m.accountSectionProfile({}, { locale }),
  reservations: m.accountSectionReservations({}, { locale }),
});

type AccountSection = keyof ReturnType<typeof accountSectionLabels>;
type ViewportMode = "desktop" | "mobile";
type ContinuityDirection = "account-to-legal" | "legal-to-account";

const accountNavigation = (page: Page, locale: Locale) =>
  page.getByRole("main").getByRole("navigation", {
    exact: true,
    name: m.accountNavigationLabel({}, { locale }),
  });

const accountSectionButton = (
  page: Page,
  locale: Locale,
  section: AccountSection
) =>
  accountNavigation(page, locale).getByRole("button", {
    exact: true,
    name: accountSectionLabels(locale)[section],
  });

const assertAccountNavigationControls = async (
  page: Page,
  locale: Locale,
  mode: ViewportMode
) => {
  const navigation = accountNavigation(page, locale);
  const navigationBox = await navigation.boundingBox();
  if (navigationBox === null)
    throw new Error("account navigation has no rendered geometry");
  expect(navigationBox.width).toBeGreaterThan(0);
  expect(navigationBox.height).toBeGreaterThan(0);

  const mobileGroup = navigation.getByRole("group", {
    exact: true,
    name: m.accountSectionLabel({}, { locale }),
  });
  expect(await mobileGroup.isVisible()).toBe(mode === "mobile");

  for (const label of Object.values(accountSectionLabels(locale))) {
    const buttons = navigation.getByRole("button", {
      exact: true,
      includeHidden: true,
      name: label,
    });
    expect(await buttons.count()).toBe(2);

    const buttonStates = await buttons.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            getComputedStyle(element).visibility !== "hidden",
          width: rect.width,
        };
      })
    );
    const visibleButtons = buttonStates.filter(({ visible }) => visible);
    expect(visibleButtons).toHaveLength(1);
    expect(visibleButtons[0]?.width).toBeGreaterThan(0);
    expect(visibleButtons[0]?.height).toBeGreaterThan(0);
  }
};

const assertMobileLegalScroll = async (page: Page) => {
  await page.waitForFunction(() => {
    const mobileNavigation = document.querySelector(
      "[data-account-mobile-navigation]"
    );
    const activeMobileButton = mobileNavigation?.querySelector(
      "button[aria-current='page']"
    );
    if (
      !(mobileNavigation instanceof HTMLElement) ||
      !(activeMobileButton instanceof HTMLButtonElement)
    ) {
      return false;
    }

    const navigationRect = mobileNavigation.getBoundingClientRect();
    const buttonRect = activeMobileButton.getBoundingClientRect();
    return (
      navigationRect.width > 0 &&
      navigationRect.height > 0 &&
      buttonRect.width > 0 &&
      buttonRect.height > 0 &&
      buttonRect.left >= navigationRect.left - 1 &&
      buttonRect.right <= navigationRect.right + 1
    );
  });

  const targetScrollY = await page.evaluate(() => {
    const header = document.querySelector("body > header");
    const navigation = document.querySelector("main aside > nav");
    if (
      !(header instanceof HTMLElement) ||
      !(navigation instanceof HTMLElement)
    ) {
      throw new Error("mobile legal scroll targets are missing");
    }

    const desiredScrollY =
      navigation.getBoundingClientRect().top +
      window.scrollY -
      header.getBoundingClientRect().bottom;
    const target = Math.max(
      0,
      Math.min(
        document.documentElement.scrollHeight - window.innerHeight,
        desiredScrollY
      )
    );
    window.scrollTo(0, target);
    return target;
  });
  await page.waitForFunction(
    (target) => Math.abs(window.scrollY - target) <= 1,
    targetScrollY
  );

  const observation = await page.evaluate(() => {
    const header = document.querySelector("body > header");
    const aside = document.querySelector("main aside");
    const navigation = aside?.querySelector("nav");
    const grid = aside?.parentElement;
    const content = grid?.children.item(1);
    const mobileFooter = grid?.children.item(2);
    const mobileNavigation = navigation?.querySelector(
      "[data-account-mobile-navigation]"
    );
    const activeMobileButton = mobileNavigation?.querySelector(
      "button[aria-current='page']"
    );
    if (
      !(header instanceof HTMLElement) ||
      !(aside instanceof HTMLElement) ||
      !(navigation instanceof HTMLElement) ||
      !(grid instanceof HTMLElement) ||
      !(content instanceof HTMLElement) ||
      !(mobileFooter instanceof HTMLElement) ||
      !(mobileNavigation instanceof HTMLElement) ||
      !(activeMobileButton instanceof HTMLButtonElement)
    ) {
      throw new Error("mobile legal scroll geometry elements are missing");
    }

    const headerRect = header.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const mobileFooterRect = mobileFooter.getBoundingClientRect();
    const mobileNavigationRect = mobileNavigation.getBoundingClientRect();
    const activeMobileButtonRect = activeMobileButton.getBoundingClientRect();
    const mobileNavigationStyle = getComputedStyle(mobileNavigation);
    const asideStyle = getComputedStyle(aside);
    const navigationRect = navigation.getBoundingClientRect();
    return {
      activeMobileButtonBottom: activeMobileButtonRect.bottom,
      activeMobileButtonHeight: activeMobileButtonRect.height,
      activeMobileButtonLeft: activeMobileButtonRect.left,
      activeMobileButtonRight: activeMobileButtonRect.right,
      activeMobileButtonSection: activeMobileButton.dataset.accountSection,
      asidePosition: asideStyle.position,
      asideTop: Number.parseFloat(asideStyle.top),
      bodyWidth: document.body.scrollWidth,
      contentBottom: contentRect.bottom,
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      helpDisplay: getComputedStyle(mobileFooter).display,
      helpTop: mobileFooterRect.top,
      headerBottom: headerRect.bottom,
      navigationHeight: navigationRect.height,
      navigationTop: navigationRect.top,
      navigationWidth: navigationRect.width,
      parentContainsNavigation: aside.contains(navigation),
      mobileNavigationHeight: mobileNavigationRect.height,
      mobileNavigationLeft: mobileNavigationRect.left,
      mobileNavigationRight: mobileNavigationRect.right,
      mobileNavigationScrollSnapType: mobileNavigationStyle.scrollSnapType,
      mobileNavigationWidth: mobileNavigationRect.width,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(targetScrollY).toBeGreaterThan(0);
  expect(observation.documentHeight).toBeGreaterThan(
    observation.viewportHeight
  );
  expect(observation.asidePosition).toBe("sticky");
  expect(observation.asideTop).toBe(96);
  expect(observation.parentContainsNavigation).toBe(true);
  expect(
    Math.abs(observation.navigationTop - observation.headerBottom)
  ).toBeLessThanOrEqual(1);
  expect(observation.navigationHeight).toBe(44);
  expect(observation.navigationWidth).toBe(observation.viewportWidth);
  expect(observation.mobileNavigationHeight).toBe(44);
  expect(observation.mobileNavigationLeft).toBe(0);
  expect(observation.mobileNavigationRight).toBe(observation.viewportWidth);
  expect(observation.mobileNavigationWidth).toBe(observation.viewportWidth);
  expect(["x", "x proximity"]).toContain(
    observation.mobileNavigationScrollSnapType
  );
  expect(observation.activeMobileButtonSection).toBe("legal");
  expect(observation.activeMobileButtonHeight).toBe(44);
  expect(observation.activeMobileButtonLeft).toBeGreaterThanOrEqual(
    observation.mobileNavigationLeft - 1
  );
  expect(observation.activeMobileButtonRight).toBeLessThanOrEqual(
    observation.mobileNavigationRight + 1
  );
  expect(observation.helpDisplay).not.toBe("none");
  expect(observation.helpTop).toBeGreaterThanOrEqual(
    observation.contentBottom - 1
  );
  expect(observation.documentWidth).toBeLessThanOrEqual(
    observation.viewportWidth + 1
  );
  expect(observation.bodyWidth).toBeLessThanOrEqual(
    observation.viewportWidth + 1
  );
};

const restoreTopScroll = async (page: Page) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
};

const assertGlobalHeaderGeometry = async (page: Page) => {
  const observation = await page
    .locator(siteHeaderSelector)
    .evaluate((header) => {
      if (!(header instanceof HTMLElement)) {
        throw new Error("global site header is not an HTMLElement");
      }
      const style = getComputedStyle(header);
      const rect = header.getBoundingClientRect();
      return {
        computedHeight: style.height,
        position: style.position,
        rectHeight: rect.height,
        width: rect.width,
        zIndex: style.zIndex,
      };
    });

  expect(observation.computedHeight).toBe("96px");
  expect(observation.position).toBe("fixed");
  expect(Math.abs(observation.rectHeight - 96)).toBeLessThanOrEqual(1);
  expect(observation.width).toBeGreaterThan(0);
  expect(observation.zIndex).toBe("50");
};

const waitForPublicLegalContent = async (page: Page, locale: Locale) => {
  const accountMain = page.getByRole("main");
  const legalTitle = accountMain.getByRole("heading", {
    exact: true,
    level: 2,
    name: m.accountLegalTitle({}, { locale }),
  });
  const legalNavigation = accountMain.getByRole("navigation", {
    exact: true,
    name: m.footerLegalLabel({}, { locale }),
  });

  await legalTitle.waitFor({ state: "visible" });
  await legalNavigation.waitFor({ state: "visible" });
  await page
    .locator("#cookie-category-necessary")
    .waitFor({ state: "visible" });
  expect(await legalTitle.count()).toBe(1);
  expect(await legalNavigation.count()).toBe(1);
};

const openFixtureContext = async (
  fixture: AccountLegalFixture,
  options: BrowserContextOptions
) => {
  const context = await fixture.browser.newContext(options);
  fixture.contexts.add(context);
  return context;
};

const closeFixtureContext = async (
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

const runPrivateContinuity = async (
  fixture: AccountLegalFixture,
  viewport: Viewport,
  locale: Locale,
  direction: ContinuityDirection
) => {
  const accountToLegal = direction === "account-to-legal";
  const context = await openFixtureContext(fixture, {
    extraHTTPHeaders: {
      [accountFixtureAuthHeader]: "private",
    },
    viewport,
  });
  const page = await context.newPage();
  const mode: ViewportMode =
    viewport.width >= accountDesktopBreakpoint ? "desktop" : "mobile";

  try {
    await page.goto(
      accountToLegal
        ? `${fixture.serverUrl}/${locale}/account?section=profile`
        : `${fixture.serverUrl}/${locale}/account/legal`,
      {
        waitUntil: "domcontentloaded",
      }
    );
    await page
      .locator('[data-fixture-hydrated="true"]')
      .waitFor({ state: "attached" });
    if (accountToLegal) {
      await page
        .locator('[data-testid="synthetic-private-content"]')
        .waitFor({ state: "visible" });
    } else {
      await waitForPublicLegalContent(page, locale);
    }
    await page.locator(accountHeaderSelector).waitFor({ state: "visible" });
    await page.locator(accountNavigationSelector).waitFor({ state: "visible" });
    await page.locator(siteHeaderSelector).waitFor({ state: "visible" });
    expect(await page.locator(siteHeaderSelector).count()).toBe(1);
    expect(await page.locator(accountHeaderSelector).count()).toBe(1);
    expect(await page.locator(accountNavigationSelector).count()).toBe(1);

    await assertAccountNavigationControls(page, locale, mode);
    const sourceSection = accountToLegal ? "profile" : "legal";
    const targetSection = accountToLegal ? "legal" : "profile";
    const sourceButton = accountSectionButton(page, locale, sourceSection);
    await sourceButton.waitFor({ state: "visible" });
    await waitForAccountSectionButtonHandler(page, sourceButton);
    expect(await sourceButton.count()).toBe(1);
    expect(await sourceButton.getAttribute("aria-current")).toBe("page");

    await captureShellReferences(page);
    const initialGeometry = await readGeometry(page);
    assertShellContinuity(await inspectShellContinuity(page), initialGeometry);

    const forward = await holdRscNavigation(
      page,
      accountToLegal ? `/${locale}/account/legal` : `/${locale}/account`,
      accountToLegal ? undefined : "profile"
    );
    try {
      const targetButton = accountSectionButton(page, locale, targetSection);
      await targetButton.waitFor({ state: "visible" });
      await waitForAccountSectionButtonHandler(page, targetButton);
      expect(await targetButton.count()).toBe(1);
      await targetButton.click();
      await forward.waitForIntercept();
      assertShellContinuity(
        await inspectShellContinuity(page),
        initialGeometry
      );

      await forward.release();
      if (accountToLegal) {
        await page.waitForURL(`${fixture.serverUrl}/${locale}/account/legal`);
        await waitForPublicLegalContent(page, locale);
        await assertAccountNavigationControls(page, locale, mode);
        if (mode === "mobile") {
          await assertMobileLegalScroll(page);
          await restoreTopScroll(page);
        }
      } else {
        await page.waitForURL(
          (url) =>
            url.pathname === `/${locale}/account` &&
            url.searchParams.get("section") === "profile"
        );
        await page
          .locator('[data-testid="synthetic-private-content"]')
          .waitFor({ state: "visible" });
        await assertAccountNavigationControls(page, locale, mode);
      }
      await page
        .locator(accountContentLoadingSelector)
        .waitFor({ state: "detached" });
      assertShellContinuity(
        await inspectShellContinuity(page),
        initialGeometry
      );
    } finally {
      await forward.dispose();
    }
  } finally {
    await closeFixtureContext(fixture, context);
  }
};

const assertAnonymousLegalRoute = async (
  fixture: AccountLegalFixture,
  locale: Locale
) => {
  const context = await openFixtureContext(fixture, {
    viewport: { height: 900, width: 375 },
  });
  const page = await context.newPage();

  try {
    await page.goto(`${fixture.serverUrl}/${locale}/account/legal`, {
      waitUntil: "domcontentloaded",
    });
    await waitForPublicLegalContent(page, locale);
    await page.locator(accountHeaderSelector).waitFor({ state: "visible" });
    await page.locator(accountNavigationSelector).waitFor({ state: "visible" });
    await page.locator(siteHeaderSelector).waitFor({ state: "visible" });
    expect(await page.locator(siteHeaderSelector).count()).toBe(1);
    expect(await page.locator(accountHeaderSelector).count()).toBe(1);
    expect(await page.locator(accountNavigationSelector).count()).toBe(1);
    await assertGlobalHeaderGeometry(page);
    await assertAccountNavigationControls(page, locale, "mobile");
    await assertMobileLegalScroll(page);
    await restoreTopScroll(page);

    const navigation = accountNavigation(page, locale);
    for (const [section, label] of Object.entries(
      accountSectionLabels(locale)
    )) {
      const buttons = navigation.getByRole("button", {
        exact: true,
        includeHidden: true,
        name: label,
      });
      expect(await buttons.count()).toBe(2);
      const disabledStates = await buttons.evaluateAll((elements) =>
        elements.map((element) => (element as HTMLButtonElement).disabled)
      );
      for (const disabled of disabledStates) {
        expect(disabled).toBe(section !== "legal");
      }
    }
  } finally {
    await closeFixtureContext(fixture, context);
  }
};

const assertSignedInRolloutOffLegalRoute = async (
  fixture: AccountLegalFixture,
  locale: Locale
) => {
  const context = await openFixtureContext(fixture, {
    extraHTTPHeaders: {
      [accountFixtureAuthHeader]: "private",
      [accountFixtureMarketingLinkHeader]: accountFixtureMarketingLinkValue,
      [accountFixtureRolloutHeader]: accountFixtureRolloutOffValue,
    },
    viewport: { height: 900, width: 375 },
  });
  const page = await context.newPage();

  try {
    await page.goto(`${fixture.serverUrl}/${locale}/account/legal`, {
      waitUntil: "domcontentloaded",
    });
    await waitForPublicLegalContent(page, locale);
    await page.locator(accountHeaderSelector).waitFor({ state: "visible" });
    await page.locator(accountNavigationSelector).waitFor({ state: "visible" });
    await page.locator(siteHeaderSelector).waitFor({ state: "visible" });

    const signOutButton = page.getByRole("button", {
      exact: true,
      name: m.accountSignOut({}, { locale }),
    });
    await signOutButton.waitFor({ state: "visible" });
    expect(await signOutButton.count()).toBe(1);

    const navigation = accountNavigation(page, locale);
    for (const section of [
      "reservations",
      "profile",
      "billing",
      "danger",
    ] as const) {
      const buttons = navigation.getByRole("button", {
        exact: true,
        includeHidden: true,
        name: accountSectionLabels(locale)[section],
      });
      expect(await buttons.count()).toBe(2);
      expect(
        await buttons.evaluateAll((elements) =>
          elements.every((element) => (element as HTMLButtonElement).disabled)
        )
      ).toBe(true);
    }

    const legalButtons = navigation.getByRole("button", {
      exact: true,
      includeHidden: true,
      name: accountSectionLabels(locale).legal,
    });
    expect(await legalButtons.count()).toBe(2);
    expect(
      await legalButtons.evaluateAll((elements) =>
        elements.every((element) => !(element as HTMLButtonElement).disabled)
      )
    ).toBe(true);

    const dedicatedLinkContent = page.locator(
      '[data-marketing-preferences="pending-link"]'
    );
    await dedicatedLinkContent.waitFor({ state: "visible" });
    expect(await dedicatedLinkContent.count()).toBe(1);
    expect(
      await page
        .getByText(marketingPreferencesFormCopy[locale].pendingDescription, {
          exact: true,
        })
        .count()
    ).toBe(1);
    await assertGlobalHeaderGeometry(page);
    await assertAccountNavigationControls(page, locale, "mobile");
    await assertMobileLegalScroll(page);
    await restoreTopScroll(page);
  } finally {
    await closeFixtureContext(fixture, context);
  }
};

const accountFixtureStartupTimeout = 180_000;
const accountFixtureCaseTimeout = 90_000;

const startAccountLegalFixture = async ({
  realCookieConsent = false,
}: AccountLegalFixtureOptions = {}): Promise<AccountLegalFixture> => {
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(
    join(fixtureParent, "deskohub-account-legal-")
  );
  const serverUrl = `http://localhost:${accountLegalPort}`;
  const exited = { value: false };
  const contexts = new Set<BrowserContext>();
  let server: ReturnType<typeof Bun.spawn> | undefined;
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
          if (!exited.value) server.kill();
          await server.exited;
          if (serverReady)
            await waitForServerToStop(`${serverUrl}/en-US/account`);
        }
      } finally {
        await rm(fixtureRoot, { force: true, recursive: true });
      }
    })();

    return closePromise;
  };

  try {
    await writeFixture(fixtureRoot, { realCookieConsent });
    const nextCli = resolve(appRoot, "node_modules/next/dist/bin/next");
    server = Bun.spawn(
      ["node", nextCli, "dev", "--webpack", "--port", String(accountLegalPort)],
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
    void server.exited.then(() => {
      exited.value = true;
    });

    await waitForServer(
      `${serverUrl}/en-US/account?section=profile`,
      exited,
      accountFixtureStartupTimeout
    );
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

describe("account legal continuity browser fixture", () => {
  let fixture: AccountLegalFixture | undefined;

  beforeAll(async () => {
    fixture = await startAccountLegalFixture();
  }, accountFixtureStartupTimeout);

  afterEach(async () => {
    if (fixture) await closeRemainingFixtureContexts(fixture.contexts);
  });

  afterAll(async () => {
    const currentFixture = fixture;
    fixture = undefined;
    await currentFixture?.close();
  });

  for (const locale of supportedLocales) {
    for (const { height, name, width } of viewports) {
      for (const direction of [
        "account-to-legal",
        "legal-to-account",
      ] as const) {
        test(`keeps ${locale} ${name} account chrome continuous for ${direction} held RSC navigation`, {
          timeout: accountFixtureCaseTimeout,
        }, async () => {
          await runPrivateContinuity(
            requireFixture(fixture),
            { height, width },
            locale,
            direction
          );
        });
      }
    }

    test(`keeps anonymous ${locale} legal route usable`, {
      timeout: accountFixtureCaseTimeout,
    }, async () => {
      await assertAnonymousLegalRoute(requireFixture(fixture), locale);
    });

    test(`keeps signed-in ${locale} public legal usable when the account rollout is off`, {
      timeout: accountFixtureCaseTimeout,
    }, async () => {
      await assertSignedInRolloutOffLegalRoute(requireFixture(fixture), locale);
    });
  }
});

const realCookieConsentLocale = "en-US" as const;
const realCookieConsentViewports = [
  { height: 900, name: "desktop 1440", width: 1440 },
  { height: 900, name: "mobile 375", width: 375 },
] as const;
const realCookieConsentCategoryTitles = {
  necessary: m.cookieSettingsNecessaryTitle(
    {},
    { locale: realCookieConsentLocale }
  ),
  analytics: m.cookieSettingsAnalyticsTitle(
    {},
    { locale: realCookieConsentLocale }
  ),
  marketing: m.cookieSettingsMarketingTitle(
    {},
    { locale: realCookieConsentLocale }
  ),
  preferences: m.cookieSettingsPreferencesTitle(
    {},
    { locale: realCookieConsentLocale }
  ),
} as const;
const realCookieBrowserActionTimeout = 15_000;

const realCookieSwitch = (page: Page, category: CookieCategory) =>
  page.getByRole("switch", {
    exact: true,
    name: realCookieConsentCategoryTitles[category],
  });

const expectRealCookieSwitchState = async (
  page: Page,
  category: CookieCategory,
  checked: boolean
) => {
  await expectLocator(realCookieSwitch(page, category)).toHaveAttribute(
    "aria-checked",
    checked ? "true" : "false"
  );
};

const toggleRealCookieCategory = async (
  page: Page,
  category: Exclude<CookieCategory, "necessary">,
  checked: boolean
) => {
  const categorySwitch = realCookieSwitch(page, category);
  const expectedChecked = checked ? "true" : "false";

  // A click can be lost when it lands while the previous consent update is
  // still re-rendering the category cards; retry against the fresh node.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForCookieSwitchHandler(page, category);
    await expectLocator(categorySwitch).toBeEnabled();
    // Playwright's locator activation sends a trusted browser interaction;
    // no evaluated DOM click or consent-cookie value is written here.
    await categorySwitch.click({
      timeout: realCookieBrowserActionTimeout,
    });
    try {
      await expectLocator(categorySwitch).toHaveAttribute(
        "aria-checked",
        expectedChecked,
        { timeout: 5_000 }
      );
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }

  // Settle: the card's pending state has cleared and the handler is reattached
  // before the next trusted click.
  await waitForCookieSwitchHandler(page, category);
  await expectLocator(categorySwitch).toBeEnabled();
};

const navigateToConsentWaypointAndBack = async (
  page: Page,
  serverUrl: string
) => {
  const localePath = `/${realCookieConsentLocale}`;
  const mobileMenuButton = page.getByRole("button", {
    exact: true,
    name: m.openNavigationMenuLabel({}, { locale: realCookieConsentLocale }),
  });
  if (await mobileMenuButton.isVisible()) {
    await mobileMenuButton.click({
      timeout: realCookieBrowserActionTimeout,
    });
  }

  const contactLink = page.getByRole("banner").getByRole("link", {
    exact: true,
    name: "Contact",
  });
  await contactLink.click({ timeout: realCookieBrowserActionTimeout });
  await page.waitForURL(`${serverUrl}${localePath}/consent-waypoint`);
  await page
    .getByRole("heading", { name: "Synthetic consent waypoint" })
    .waitFor({ state: "visible" });

  const backLink = page.getByRole("link", {
    exact: true,
    name: "Back to public legal",
  });
  await backLink.click({ timeout: realCookieBrowserActionTimeout });
  await page.waitForURL(`${serverUrl}${localePath}/account/legal`);
};

// Local red assertion isolated from the shared helper source: the retired
// expectation required visible accept-all/reject-all bulk buttons on the
// public legal screen. Production public legal markup keeps those bulk
// buttons out of the account legal main content, so this must fail.
const assertLegacyBulkButtonsVisible = async (page: Page) => {
  const accountMain = page.getByRole("main");
  await expectLocator(
    accountMain.getByRole("button", {
      exact: true,
      name: m.cookieSettingsAcceptAll({}, { locale: realCookieConsentLocale }),
    })
  ).toBeVisible();
  await expectLocator(
    accountMain.getByRole("button", {
      exact: true,
      name: m.cookieSettingsRejectAll({}, { locale: realCookieConsentLocale }),
    })
  ).toBeVisible();
};

const expectAssertionFailure = async (
  assert: () => Promise<void>
): Promise<string> => {
  try {
    await assert();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected legacy assertion to fail against public legal");
};

const runRealCookieConsentContinuity = async (
  fixture: AccountLegalFixture,
  viewport: Viewport
) => {
  const context = await openFixtureContext(fixture, { viewport });
  // Emulate an ordinary browser so the real vendor hydration runs exactly as
  // it does for human visitors (the vendor skips cookie hydration under
  // navigator.webdriver); no cookies are injected and no auth is bypassed.
  await preparePublicLegalBrowser(context);
  const page = await context.newPage();

  try {
    await expectNoAuthSessionCookie(context);
    await page.goto(
      `${fixture.serverUrl}/${realCookieConsentLocale}/account/legal`,
      { waitUntil: "domcontentloaded" }
    );
    await page
      .locator('[data-fixture-hydrated="true"]')
      .waitFor({ state: "attached" });
    await dismissLegalCookieConsent(page, realCookieConsentLocale);
    await expectPublicAccountLegal(page);

    await toggleRealCookieCategory(page, "preferences", true);
    await toggleRealCookieCategory(page, "analytics", true);
    await toggleRealCookieCategory(page, "marketing", true);
    await expectRealCookieSwitchState(page, "necessary", true);
    await expectLocator(realCookieSwitch(page, "necessary")).toBeDisabled();

    await navigateToConsentWaypointAndBack(page, fixture.serverUrl);
    await page
      .getByRole("heading", {
        exact: true,
        level: 2,
        name: m.accountLegalTitle({}, { locale: realCookieConsentLocale }),
      })
      .waitFor({ state: "visible" });
    for (const category of ["analytics", "marketing", "preferences"] as const) {
      await expectRealCookieSwitchState(page, category, true);
    }

    await page.reload({ waitUntil: "load" });
    await dismissLegalCookieConsent(page, realCookieConsentLocale);
    for (const category of ["analytics", "marketing", "preferences"] as const) {
      await expectRealCookieSwitchState(page, category, true);
    }
    await expectRealCookieSwitchState(page, "necessary", true);
    await expectLocator(realCookieSwitch(page, "necessary")).toBeDisabled();

    await toggleRealCookieCategory(page, "analytics", false);
    await expectRealCookieSwitchState(page, "marketing", true);
    await expectRealCookieSwitchState(page, "preferences", true);

    await toggleRealCookieCategory(page, "marketing", false);
    await expectRealCookieSwitchState(page, "preferences", true);

    await toggleRealCookieCategory(page, "preferences", false);
    await expectRealCookieSwitchState(page, "necessary", true);
    await expectLocator(realCookieSwitch(page, "necessary")).toBeDisabled();
    await expectNoAuthSessionCookie(context);
  } finally {
    await closeFixtureContext(fixture, context);
  }
};

describe("account legal continuity real cookie consent fixture", () => {
  let fixture: AccountLegalFixture | undefined;

  beforeAll(async () => {
    fixture = await startAccountLegalFixture({ realCookieConsent: true });
  }, accountFixtureStartupTimeout);

  afterEach(async () => {
    if (fixture) await closeRemainingFixtureContexts(fixture.contexts);
  });

  afterAll(async () => {
    const currentFixture = fixture;
    fixture = undefined;
    await currentFixture?.close();
  });

  test("fails the retired bulk-button assertion and passes the migrated helper on real public legal", {
    timeout: accountFixtureCaseTimeout,
  }, async () => {
    const currentFixture = requireFixture(fixture);
    const context = await openFixtureContext(currentFixture, {
      viewport: { height: 900, width: 1440 },
    });
    // Same ordinary-browser emulation as the migrated preview test so the
    // real vendor hydrates; no cookies are injected and no auth is bypassed.
    await preparePublicLegalBrowser(context);
    const page = await context.newPage();

    try {
      await page.goto(
        `${currentFixture.serverUrl}/${realCookieConsentLocale}/account/legal`,
        { waitUntil: "domcontentloaded" }
      );
      await page
        .locator('[data-fixture-hydrated="true"]')
        .waitFor({ state: "attached" });
      await dismissLegalCookieConsent(page, realCookieConsentLocale);

      const legacyFailure = await expectAssertionFailure(() =>
        assertLegacyBulkButtonsVisible(page)
      );
      expectLocator(legacyFailure).toContain(
        m.cookieSettingsAcceptAll({}, { locale: realCookieConsentLocale })
      );

      // The migrated shared helper must pass against the same production
      // public legal markup with the real consent provider mounted.
      await expectPublicAccountLegal(page);
    } finally {
      await closeFixtureContext(currentFixture, context);
    }
  });

  for (const { height, name, width } of realCookieConsentViewports) {
    test(`keeps ${name} real cookie switches persistent across navigation and reload`, {
      timeout: accountFixtureCaseTimeout,
    }, async () => {
      await runRealCookieConsentContinuity(requireFixture(fixture), {
        height,
        width,
      });
    });
  }
});
