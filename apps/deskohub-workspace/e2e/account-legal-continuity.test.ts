import { describe, expect, test } from "bun:test";
import type { Page, Route } from "@playwright/test";
import { getAccountSectionPath } from "@/features/account/routes";
import {
  type AccountSection,
  accountSectionLabel,
} from "@/features/account/sections";
import { type Locale, m } from "@/features/i18n";
import {
  type AccountLegalFixture,
  accountFixtureAuthHeader,
  accountFixtureCaseTimeout,
  closeFixtureContext,
  openFixtureContext,
  registerAccountLegalFixture,
  type Viewport,
} from "./account-legal-fixture";
import { isNotFoundPage } from "./not-found-page";
import { waitForReactClickHandler } from "./react-handlers";

const siteHeaderSelector = "body > header";
const accountHeaderSelector = "main > div > header";
const accountNavigationSelector = "main aside > nav";
const accountContentLoadingSelector = '[data-slot="account-content-loading"]';
// Locale only changes copy, so each locale covers one breakpoint: the
// narrowest mobile width with the longer Czech labels, and desktop.
const continuityCases = [
  {
    locale: "cs-CZ",
    viewport: { height: 900, name: "mobile 320", width: 320 },
  },
  {
    locale: "en-US",
    viewport: { height: 900, name: "desktop", width: 1440 },
  },
] as const satisfies readonly {
  readonly locale: Locale;
  readonly viewport: Viewport & { readonly name: string };
}[];

const accountDesktopBreakpoint = 768;

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

const isTargetRscRequest = (route: Route, expectedPathname: string) => {
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
  return url.pathname === expectedPathname;
};

const heldRscFetchAttempts = 3;

// The harness forwards the held navigation through Playwright's own HTTP
// client. A transport failure there (for example a reset keep-alive socket
// to the dev server) aborts the browser request, and Next falls back to a
// document navigation that discards the captured shell references. Retry
// this idempotent RSC GET, and surface the transport error if it persists.
const fetchHeldRscResponse = async (route: Route) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= heldRscFetchAttempts; attempt += 1) {
    try {
      return await route.fetch();
    } catch (error) {
      lastError = error;
      await Bun.sleep(100 * attempt);
    }
  }
  throw new Error("held RSC navigation could not be forwarded", {
    cause: lastError,
  });
};

const holdRscNavigation = async (
  page: Page,
  expectedPathname: string
): Promise<HeldRscNavigation> => {
  const intercepted = makeDeferred<void>();
  const release = makeDeferred<void>();
  const pending = new Set<Promise<void>>();
  const routePattern = "**/*";

  const handler = async (route: Route) => {
    if (!isTargetRscRequest(route, expectedPathname)) {
      await route.continue();
      return;
    }

    const responseWork = (async () => {
      try {
        const response = await fetchHeldRscResponse(route);
        intercepted.resolve();
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

const continuitySections = [
  "billing",
  "danger",
  "legal",
  "profile",
  "reservations",
] as const satisfies readonly AccountSection[];

type ContinuitySection = (typeof continuitySections)[number];
type ViewportMode = "desktop" | "mobile";
type ContinuityDirection = "account-to-legal" | "legal-to-account";

const accountNavigation = (page: Page, locale: Locale) =>
  page.getByRole("main").getByRole("navigation", {
    exact: true,
    name: m.accountNavigationLabel({}, { locale }),
  });

const accountSectionLink = (
  page: Page,
  locale: Locale,
  section: ContinuitySection
) =>
  accountNavigation(page, locale).getByRole("link", {
    exact: true,
    name: accountSectionLabel(section, locale),
  });

const assertAccountNavigationControls = async (
  page: Page,
  locale: Locale,
  mode: ViewportMode,
  privateNavigationEnabled: boolean
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

  for (const section of continuitySections) {
    const label = accountSectionLabel(section, locale);
    const privateSection = section !== "legal";
    const enabled = !privateSection || privateNavigationEnabled;
    const links = navigation.getByRole("link", {
      exact: true,
      includeHidden: true,
      name: label,
    });
    const buttons = navigation.getByRole("button", {
      exact: true,
      includeHidden: true,
      name: label,
    });
    expect(await links.count()).toBe(enabled ? 2 : 0);
    expect(await buttons.count()).toBe(enabled ? 0 : 2);

    if (enabled) {
      const expectedHref = getAccountSectionPath(locale, section);
      expect(
        await links.evaluateAll(
          (elements, href) =>
            elements.every((element) => element.getAttribute("href") === href),
          expectedHref
        )
      ).toBe(true);
    } else {
      expect(
        await buttons.evaluateAll((elements) =>
          elements.every((element) => (element as HTMLButtonElement).disabled)
        )
      ).toBe(true);
    }

    const controlStates = await (enabled ? links : buttons).evaluateAll(
      (elements) =>
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
    const visibleControls = controlStates.filter(({ visible }) => visible);
    expect(visibleControls).toHaveLength(1);
    expect(visibleControls[0]?.width).toBeGreaterThan(0);
    expect(visibleControls[0]?.height).toBeGreaterThan(0);
  }
};

const assertMobileLegalScroll = async (page: Page) => {
  await page.waitForFunction(() => {
    const mobileNavigation = document.querySelector(
      "[data-account-mobile-navigation]"
    );
    const activeMobileLink = mobileNavigation?.querySelector(
      "a[aria-current='page']"
    );
    if (
      !(mobileNavigation instanceof HTMLElement) ||
      !(activeMobileLink instanceof HTMLAnchorElement)
    ) {
      return false;
    }

    const navigationRect = mobileNavigation.getBoundingClientRect();
    const linkRect = activeMobileLink.getBoundingClientRect();
    return (
      navigationRect.width > 0 &&
      navigationRect.height > 0 &&
      linkRect.width > 0 &&
      linkRect.height > 0 &&
      linkRect.left >= navigationRect.left - 1 &&
      linkRect.right <= navigationRect.right + 1
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
    const activeMobileLink = mobileNavigation?.querySelector(
      "a[aria-current='page']"
    );
    if (
      !(header instanceof HTMLElement) ||
      !(aside instanceof HTMLElement) ||
      !(navigation instanceof HTMLElement) ||
      !(grid instanceof HTMLElement) ||
      !(content instanceof HTMLElement) ||
      !(mobileFooter instanceof HTMLElement) ||
      !(mobileNavigation instanceof HTMLElement) ||
      !(activeMobileLink instanceof HTMLAnchorElement)
    ) {
      throw new Error("mobile legal scroll geometry elements are missing");
    }

    const headerRect = header.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const mobileFooterRect = mobileFooter.getBoundingClientRect();
    const mobileNavigationRect = mobileNavigation.getBoundingClientRect();
    const activeMobileLinkRect = activeMobileLink.getBoundingClientRect();
    const mobileNavigationStyle = getComputedStyle(mobileNavigation);
    const asideStyle = getComputedStyle(aside);
    const navigationRect = navigation.getBoundingClientRect();
    return {
      activeMobileLinkBottom: activeMobileLinkRect.bottom,
      activeMobileLinkHeight: activeMobileLinkRect.height,
      activeMobileLinkLeft: activeMobileLinkRect.left,
      activeMobileLinkRight: activeMobileLinkRect.right,
      activeMobileLinkSection: activeMobileLink.dataset.accountSection,
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
  expect(observation.activeMobileLinkSection).toBe("legal");
  expect(observation.activeMobileLinkHeight).toBe(44);
  expect(observation.activeMobileLinkLeft).toBeGreaterThanOrEqual(
    observation.mobileNavigationLeft - 1
  );
  expect(observation.activeMobileLinkRight).toBeLessThanOrEqual(
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
    name: m.legalScreenTitle({}, { locale }),
  });

  await legalTitle.waitFor({ state: "visible" });
  await legalNavigation.waitFor({ state: "visible" });
  await page
    .locator("#cookie-category-necessary")
    .waitFor({ state: "visible" });
  expect(await legalTitle.count()).toBe(1);
  expect(await legalNavigation.count()).toBe(1);
};

const assertBareReservationsClickIsNoop = async (
  fixture: AccountLegalFixture,
  locale: Locale
) => {
  const context = await openFixtureContext(fixture, {
    extraHTTPHeaders: {
      [accountFixtureAuthHeader]: "private",
    },
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  const accountUrl = `${fixture.serverUrl}/${locale}/account`;

  try {
    await page.goto(accountUrl, { waitUntil: "domcontentloaded" });
    await page
      .locator('[data-fixture-hydrated="true"]')
      .waitFor({ state: "attached" });
    await page
      .locator('[data-testid="synthetic-private-content"]')
      .waitFor({ state: "visible" });

    const reservationsLink = accountSectionLink(page, locale, "reservations");
    await reservationsLink.waitFor({ state: "visible" });
    await waitForReactClickHandler(page, reservationsLink);
    expect(await reservationsLink.getAttribute("href")).toBe(
      getAccountSectionPath(locale, "reservations")
    );
    expect(await reservationsLink.getAttribute("aria-current")).toBe("page");

    await reservationsLink.click();
    expect(page.url()).toBe(accountUrl);
  } finally {
    await closeFixtureContext(fixture, context);
  }
};

// The navigation switches sections by replacing the URL, so a revalidating
// Server Action then renders the switched path's route over the one the page
// loaded at. Neither a remount nor a full reload may drop open client state.
const assertDraftSurvivesRevalidationAfterSwitch = async (
  fixture: AccountLegalFixture,
  entryPath: string
) => {
  const locale = "en-US";
  const context = await openFixtureContext(fixture, {
    extraHTTPHeaders: { [accountFixtureAuthHeader]: "private" },
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  const documentLoads: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document")
      documentLoads.push(request.url());
  });

  try {
    await page.goto(`${fixture.serverUrl}${entryPath}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator('[data-fixture-hydrated="true"]')
      .waitFor({ state: "attached" });
    const openDraft = page.getByTestId("fixture-draft-open");
    await waitForReactClickHandler(page, openDraft);
    await openDraft.click();
    const draft = page.getByTestId("fixture-draft");
    await draft.waitFor({ state: "visible" });
    await draft.evaluate((element) => {
      element.setAttribute("data-draft-marker", "original");
    });
    const documentLoadsBefore = documentLoads.length;

    const dangerLink = accountSectionLink(page, locale, "danger");
    await waitForReactClickHandler(page, dangerLink);
    await dangerLink.click();
    await page.waitForURL(
      `${fixture.serverUrl}${getAccountSectionPath(locale, "danger")}`
    );

    await page.getByTestId("fixture-draft-revalidate").click();
    await page
      .locator('[data-testid="fixture-draft-revalidations"]', { hasText: "1" })
      .waitFor({ state: "visible" });

    expect(documentLoads.slice(documentLoadsBefore)).toEqual([]);
    expect(await draft.getAttribute("data-draft-marker")).toBe("original");
    expect(new URL(page.url()).pathname).toBe(
      getAccountSectionPath(locale, "danger")
    );
  } finally {
    await closeFixtureContext(fixture, context);
  }
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
        ? new URL(getAccountSectionPath(locale, "profile"), fixture.serverUrl)
            .href
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

    await assertAccountNavigationControls(page, locale, mode, true);
    const sourceSection = accountToLegal ? "profile" : "legal";
    const targetSection = accountToLegal ? "legal" : "profile";
    const sourceLink = accountSectionLink(page, locale, sourceSection);
    await sourceLink.waitFor({ state: "visible" });
    await waitForReactClickHandler(page, sourceLink);
    expect(await sourceLink.count()).toBe(1);
    expect(await sourceLink.getAttribute("aria-current")).toBe("page");

    await captureShellReferences(page);
    const initialGeometry = await readGeometry(page);
    assertShellContinuity(await inspectShellContinuity(page), initialGeometry);

    const forward = await holdRscNavigation(
      page,
      getAccountSectionPath(locale, targetSection)
    );
    try {
      const targetLink = accountSectionLink(page, locale, targetSection);
      await targetLink.waitFor({ state: "visible" });
      await waitForReactClickHandler(page, targetLink);
      expect(await targetLink.count()).toBe(1);
      await targetLink.click();
      await forward.waitForIntercept();
      assertShellContinuity(
        await inspectShellContinuity(page),
        initialGeometry
      );

      await forward.release();
      if (accountToLegal) {
        await page.waitForURL(`${fixture.serverUrl}/${locale}/account/legal`);
        await waitForPublicLegalContent(page, locale);
        await assertAccountNavigationControls(page, locale, mode, true);
        if (mode === "mobile") {
          await assertMobileLegalScroll(page);
          await restoreTopScroll(page);
        }
      } else {
        await page.waitForURL(
          new URL(getAccountSectionPath(locale, "profile"), fixture.serverUrl)
            .href
        );
        await page
          .locator('[data-testid="synthetic-private-content"]')
          .waitFor({ state: "visible" });
        await assertAccountNavigationControls(page, locale, mode, true);
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
    await assertAccountNavigationControls(page, locale, "mobile", false);
    await assertMobileLegalScroll(page);
    await restoreTopScroll(page);

    const navigation = accountNavigation(page, locale);
    for (const section of continuitySections) {
      const label = accountSectionLabel(section, locale);
      const links = navigation.getByRole("link", {
        exact: true,
        includeHidden: true,
        name: label,
      });
      const buttons = navigation.getByRole("button", {
        exact: true,
        includeHidden: true,
        name: label,
      });
      if (section === "legal") {
        expect(await links.count()).toBe(2);
        expect(await buttons.count()).toBe(0);
      } else {
        expect(await links.count()).toBe(0);
        expect(await buttons.count()).toBe(2);
        expect(
          await buttons.evaluateAll((elements) =>
            elements.every((element) => (element as HTMLButtonElement).disabled)
          )
        ).toBe(true);
      }
    }
  } finally {
    await closeFixtureContext(fixture, context);
  }
};

const isSignInPathname = (url: string) =>
  /\/auth\/sign-in\/?$/.test(new URL(url).pathname);

/** Opens an account path, recording every request on the way to sign-in. */
const openAccountPath = async (
  fixture: AccountLegalFixture,
  path: string,
  { signedIn }: { readonly signedIn: boolean }
) => {
  const context = await openFixtureContext(fixture, {
    viewport: { height: 900, width: 1440 },
    ...(signedIn
      ? { extraHTTPHeaders: { [accountFixtureAuthHeader]: "private" } }
      : {}),
  });
  const page = await context.newPage();
  const signInRequests: string[] = [];
  page.on("request", (request) => {
    if (isSignInPathname(request.url())) signInRequests.push(request.url());
  });
  const url = `${fixture.serverUrl}${path}`;
  const response = await page.goto(url, { waitUntil: "load" });
  return { context, page, response, signInRequests, url };
};

// The sections' layout renders the account page beside the path's own page,
// so a signed-out account page's redirect to sign-in must never start for a
// path the page finds missing. The fixture withholds Referrals and Sign-in &
// security.
const assertSectionPathNotFound = async (
  fixture: AccountLegalFixture,
  path: string,
  { signedIn }: { readonly signedIn: boolean }
) => {
  const { context, page, response, signInRequests, url } =
    await openAccountPath(fixture, path, { signedIn });

  try {
    const body = (await response?.text()) ?? "";
    expect(isNotFoundPage(body)).toBe(true);
    // Neither the account page nor its redirect to sign-in renders at all.
    expect(body).not.toContain("synthetic-private-content");
    expect(body).not.toContain("sign-in-loading");
    await page.waitForFunction(
      () => document.documentElement.dataset.fixtureHydrated === "true"
    );
    // A signed-out account page starts its redirect once it hydrates, which
    // the dev server can take seconds to reach.
    await expect(
      page.waitForURL(isSignInPathname, { timeout: signInRedirectWindow })
    ).rejects.toThrow();
    expect(page.url()).toBe(url);
    expect(signInRequests).toEqual([]);
    expect(
      await page.locator('[data-testid="synthetic-private-content"]').count()
    ).toBe(0);
    expect(await page.locator('[data-slot="sign-in-loading"]').count()).toBe(0);
  } finally {
    await closeFixtureContext(fixture, context);
  }
};

const assertAnonymousSectionPathSignsIn = async (
  fixture: AccountLegalFixture,
  path: string
) => {
  const { context, page } = await openAccountPath(fixture, path, {
    signedIn: false,
  });

  try {
    await page.waitForURL(isSignInPathname);
    expect(new URL(page.url()).pathname).toBe("/en-US/auth/sign-in");
  } finally {
    await closeFixtureContext(fixture, context);
  }
};

const signInRedirectWindow = 5_000;

const missingSectionPaths = [
  "/en-US/account/unknown",
  "/en-US/account/security",
  "/en-US/account/referrals",
] as const;

describe("account legal continuity browser fixture", () => {
  const requireFixture = registerAccountLegalFixture();

  test("keeps the bare account URL when active Reservations is clicked", {
    timeout: accountFixtureCaseTimeout,
  }, async () => {
    await assertBareReservationsClickIsNoop(requireFixture(), "en-US");
  });

  for (const { locale, viewport } of continuityCases) {
    const { height, name, width } = viewport;
    for (const direction of ["account-to-legal", "legal-to-account"] as const) {
      test(`keeps ${locale} ${name} account chrome continuous for ${direction} held RSC navigation`, {
        timeout: accountFixtureCaseTimeout,
      }, async () => {
        await runPrivateContinuity(
          requireFixture(),
          { height, width },
          locale,
          direction
        );
      });
    }
  }

  for (const path of missingSectionPaths) {
    for (const signedIn of [false, true]) {
      test(`shows ${signedIn ? "a signed-in" : "an anonymous"} visitor not found at ${path}`, {
        timeout: accountFixtureCaseTimeout,
      }, async () => {
        await assertSectionPathNotFound(requireFixture(), path, { signedIn });
      });
    }
  }

  for (const path of ["/en-US/account", "/en-US/account/profile"]) {
    test(`keeps client state through a revalidating action after switching from ${path}`, {
      timeout: accountFixtureCaseTimeout,
    }, async () => {
      await assertDraftSurvivesRevalidationAfterSwitch(requireFixture(), path);
    });
  }

  for (const path of ["/en-US/account", "/en-US/account/profile"]) {
    test(`sends an anonymous visitor at ${path} to sign-in`, {
      timeout: accountFixtureCaseTimeout,
    }, async () => {
      await assertAnonymousSectionPathSignsIn(requireFixture(), path);
    });
  }

  test("keeps anonymous cs-CZ legal route usable", {
    timeout: accountFixtureCaseTimeout,
  }, async () => {
    await assertAnonymousLegalRoute(requireFixture(), "cs-CZ");
  });
});
