import { describe, expect, test } from "bun:test";
import type { Page, Route } from "@playwright/test";
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
    await waitForReactClickHandler(page, sourceButton);
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
      await waitForReactClickHandler(page, targetButton);
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

describe("account legal continuity browser fixture", () => {
  const requireFixture = registerAccountLegalFixture();

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

  test("keeps anonymous cs-CZ legal route usable", {
    timeout: accountFixtureCaseTimeout,
  }, async () => {
    await assertAnonymousLegalRoute(requireFixture(), "cs-CZ");
  });
});
