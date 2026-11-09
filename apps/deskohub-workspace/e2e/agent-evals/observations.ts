import type { BrowserContext, Page } from "@playwright/test";
import { locales } from "@/features/i18n";

/** Where a top-level page was, by route family; never the full URL. */
export type AgentEvalRoute =
  | "reservation-cowork"
  | "reservation-meeting-room"
  | "reservation-office"
  | "pay"
  | "sign-in"
  | "account"
  | "status"
  | "payment-provider"
  | "site"
  | "external";

export type AgentEvalUrlOrigins = {
  readonly siteOrigin: string;
  /** Host of the hosted payment page (the Nexi sandbox). */
  readonly paymentProviderHost: string;
};

const localePrefix = new RegExp(`^/(?:${locales.join("|")})(?=/|$)`);

const siteRoutes: readonly (readonly [RegExp, AgentEvalRoute])[] = [
  [/^\/reservation\/cowork(?:\/|$)/, "reservation-cowork"],
  [/^\/reservation\/meeting-room(?:\/|$)/, "reservation-meeting-room"],
  [/^\/reservation\/office(?:\/|$)/, "reservation-office"],
  [/^\/reservation\/status\//, "status"],
  [/^\/checkout\/pay\/?$/, "pay"],
  [/^\/auth\/sign-in(?:\/|$)/, "sign-in"],
  [/^\/account(?:\/|$)/, "account"],
];

/** Classifies a top-level URL; undefined for blank and browser pages. */
export const classifyAgentEvalUrl = (
  url: string,
  origins: AgentEvalUrlOrigins
): AgentEvalRoute | undefined => {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return undefined;
  }
  if (parsed.hostname === origins.paymentProviderHost) {
    return "payment-provider";
  }
  if (parsed.origin !== origins.siteOrigin) return "external";
  const path = parsed.pathname.replace(localePrefix, "") || "/";
  return siteRoutes.find(([pattern]) => pattern.test(path))?.[1] ?? "site";
};

/**
 * What the browser showed during one run, measured from the task start. The
 * payment page facts are the evidence for the new-tab versus same-tab
 * payment handoff decision.
 */
export type AgentEvalBrowserObservations = {
  /** Route families in first-visit order. */
  readonly routes: readonly AgentEvalRoute[];
  readonly timeToPayUrlMs: number | null;
  readonly paymentPage: {
    readonly openedAfterMs: number;
    /** Opened in a tab other than the one the run started in. */
    readonly inNewTab: boolean;
    /** The agent clicked or typed on the payment page. */
    readonly actedIn: boolean;
  } | null;
  /** The last status page URL the agent reached; not persisted in results. */
  readonly statusPageUrl: string | null;
  readonly tabCount: number;
};

const paymentInputBinding = "__workspaceAgentEvalPaymentInput";

/**
 * Starts recording what every tab of the agent's context shows. Call it
 * after the start page loaded, at the moment the task starts.
 */
export const observeAgentEvalBrowser = async (
  context: BrowserContext,
  startPage: Page,
  origins: AgentEvalUrlOrigins
) => {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const routes: AgentEvalRoute[] = [];
  const paymentPages = new Set<Page>();
  const pages = new Set<Page>();
  let timeToPayUrlMs: number | null = null;
  let statusPageUrl: string | null = null;
  let paymentPage: {
    openedAfterMs: number;
    inNewTab: boolean;
    actedIn: boolean;
  } | null = null;

  const record = (page: Page, url: string) => {
    const route = classifyAgentEvalUrl(url, origins);
    if (!route) return;
    if (!routes.includes(route)) routes.push(route);
    if (route === "pay" && timeToPayUrlMs === null) timeToPayUrlMs = elapsed();
    if (route === "status") statusPageUrl = url;
    if (route === "payment-provider") {
      paymentPages.add(page);
      paymentPage ??= {
        actedIn: false,
        inNewTab: page !== startPage,
        openedAfterMs: elapsed(),
      };
    }
  };

  const track = (page: Page) => {
    if (pages.has(page)) return;
    pages.add(page);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) record(page, frame.url());
    });
    // A tab another CDP client opened may have committed its first URL
    // before this context reported the page.
    record(page, page.url());
  };

  // Input on the hosted payment page, including its card-field iframes, is
  // reported through a binding: navigation alone can't tell an agent that
  // only looked at the page from one that started paying.
  await context.exposeBinding(paymentInputBinding, ({ page }) => {
    if (paymentPage && paymentPages.has(page)) paymentPage.actedIn = true;
  });
  await context.addInitScript(
    ({ binding, host }) => {
      if (location.hostname !== host) return;
      const report = () => {
        const notify: unknown = Reflect.get(window, binding);
        if (typeof notify === "function") notify();
      };
      for (const type of ["pointerdown", "keydown", "input"]) {
        addEventListener(type, report, { capture: true, once: true });
      }
    },
    { binding: paymentInputBinding, host: origins.paymentProviderHost }
  );

  pages.add(startPage);
  startPage.on("framenavigated", (frame) => {
    if (frame === startPage.mainFrame()) record(startPage, frame.url());
  });
  for (const page of context.pages()) track(page);
  context.on("page", track);

  return {
    snapshot: (): AgentEvalBrowserObservations => ({
      paymentPage: paymentPage ? { ...paymentPage } : null,
      routes: [...routes],
      statusPageUrl,
      tabCount: pages.size,
      timeToPayUrlMs,
    }),
  };
};
