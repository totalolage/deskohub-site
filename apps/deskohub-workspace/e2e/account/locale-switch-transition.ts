import type { Page, Route } from "@playwright/test";
import {
  getAccountPath,
  getAccountSectionPath,
} from "@/features/account/routes";
import { type Locale, locales, m } from "@/features/i18n";
import {
  type WorkspaceE2EAccountLocaleSwitchDiagnosticCode,
  workspaceE2EError,
} from "../errors";
import { waitForReactClickHandler } from "../react-handlers";
import { redact } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  accountSectionLandmarks,
  selectAccountSection,
  waitForSelectedAccountSection,
} from "./account-sections";

const accountProfilePath = (locale: Locale) =>
  getAccountSectionPath(locale, "profile");
const languageTriggerSelector = `${accountSectionLandmarks.profile} [data-slot="select-trigger"]`;
const languageOptionLabels = {
  "cs-CZ": "Čeština",
  "en-US": "English (US)",
} as const satisfies Readonly<Record<Locale, string>>;
const localeSwitchLinkSelector = (locale: Locale) =>
  `[data-locale-switcher] a[href^="/${locale}"]`;
const mobileMenuToggleSelector =
  'button[aria-controls="site-header-mobile-menu"]';

/**
 * The tab's sessionStorage key for the error-page watch. An empty value arms
 * the watch, a path records where the error page showed, and no value
 * disarms it. Session storage outlives the switch's document navigation, so
 * the old page's record survives into the new one.
 */
export const localeSwitchErrorPageKey = "deskohub-e2e-locale-switch-error-page";

/**
 * Records the path of the first error page the document shows while the
 * watch is armed. It runs in the page, so it takes only serializable input.
 */
export const watchLocaleSwitchErrorPage = ({
  key,
  titles,
}: {
  readonly key: string;
  readonly titles: readonly string[];
}) => {
  if (window.sessionStorage.getItem(key) !== "") return;
  const observer = new MutationObserver(() => check());
  const check = () => {
    if (window.sessionStorage.getItem(key) !== "") {
      observer.disconnect();
      return;
    }
    const shown = Array.from(document.querySelectorAll("h1")).some((heading) =>
      titles.includes(heading.textContent?.trim() ?? "")
    );
    if (!shown) return;
    window.sessionStorage.setItem(
      key,
      `${window.location.pathname}${window.location.search}`
    );
    observer.disconnect();
  };
  observer.observe(document, {
    characterData: true,
    childList: true,
    subtree: true,
  });
  check();
};

const errorPageWatch = {
  key: localeSwitchErrorPageKey,
  titles: locales.map((locale) => m.errorPageTitle({}, { locale })),
};

/**
 * Holds the preference save and the new locale's document, so the old page
 * stays on screen with the save's response applied before the document
 * navigation replaces it. Every other request passes untouched.
 */
const holdLocaleSwitchResponses = async (
  page: Page,
  from: Locale,
  to: Locale
): Promise<() => Promise<void>> => {
  const matches = (url: URL) =>
    url.pathname === accountProfilePath(from) ||
    url.pathname === accountProfilePath(to);
  const hold = async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const isSave =
      request.method() === "POST" &&
      (await request.headerValue("next-action")) !== null;
    const isNewDocument =
      request.isNavigationRequest() && pathname === accountProfilePath(to);
    if (isSave || isNewDocument) {
      await new Promise((resolve) =>
        setTimeout(resolve, workspaceE2ETimeouts.localeSwitchHeldResponse)
      );
    }
    await route.fallback();
  };
  await page.route(matches, hold);
  return () => page.unroute(matches, hold);
};

const profileCopy = (locale: Locale) => ({
  label: m.accountSectionProfile({}, { locale }),
  navigationLabel: m.accountNavigationLabel({}, { locale }),
});

type LocaleSwitch = {
  readonly from: Locale;
  readonly to: Locale;
  /** Switches the locale through the real UI of the open profile. */
  readonly trigger: (page: Page, to: Locale) => Promise<void>;
};

/** Chooses the language in the profile's preferred-language control. */
const chooseProfileLanguage = async (page: Page, to: Locale) => {
  const trigger = page.locator(languageTriggerSelector);
  await page.waitForFunction(
    (selector) => {
      const element = document.querySelector(selector);
      if (element === null) return false;
      const propsKey = Object.keys(element).find((key) =>
        key.startsWith("__reactProps$")
      );
      const props: unknown =
        propsKey === undefined ? undefined : Reflect.get(element, propsKey);
      return (
        typeof props === "object" &&
        props !== null &&
        typeof Reflect.get(props, "onPointerDown") === "function"
      );
    },
    languageTriggerSelector,
    { timeout: workspaceE2ETimeouts.uiTransition }
  );
  await trigger.click({ timeout: workspaceE2ETimeouts.browserAction });
  await page
    .getByRole("option", { name: languageOptionLabels[to] })
    .click({ timeout: workspaceE2ETimeouts.browserAction });
};

/**
 * Clicks the visible header language switcher's link, as a visitor's tap
 * does. Below the desktop breakpoint the switcher sits in the collapsed
 * mobile menu, so the menu opens first.
 */
export const activateHeaderSwitcher = async (page: Page, to: Locale) => {
  const menuToggle = page.locator(mobileMenuToggleSelector);
  if (await menuToggle.isVisible()) {
    await waitForReactClickHandler(page, menuToggle);
    await menuToggle.click({ timeout: workspaceE2ETimeouts.browserAction });
  }
  const link = page
    .locator(localeSwitchLinkSelector(to))
    .filter({ visible: true });
  await waitForReactClickHandler(page, link);
  await link.click({ timeout: workspaceE2ETimeouts.browserAction });
};

/**
 * Switches the locale from the open profile and requires the new locale's
 * account to land with the profile still selected, with no error page or
 * uncaught page error at any point in between.
 */
const verifyLocaleSwitch = async (
  page: Page,
  { from, to, trigger }: LocaleSwitch
) => {
  // Each uncaught error's name and opening message, redacted, with the path
  // of the document it reached, so a failure says what threw and on which
  // side of the switch without carrying page content.
  const pageErrors: string[] = [];
  const recordPageError = (error: Error) => {
    const { pathname } = new URL(page.url());
    pageErrors.push(
      `${redact(`${error.name}: ${error.message}`).slice(0, 200)} on ${redact(pathname)}`
    );
  };
  await page.evaluate((key) => {
    window.sessionStorage.setItem(key, "");
  }, localeSwitchErrorPageKey);
  await page.evaluate(watchLocaleSwitchErrorPage, errorPageWatch);
  const release = await holdLocaleSwitchResponses(page, from, to);
  page.on("pageerror", recordPageError);
  const fail = (
    code: WorkspaceE2EAccountLocaleSwitchDiagnosticCode,
    detail: string
  ) =>
    workspaceE2EError(
      `The ${from} to ${to} locale switch from the profile failed (${detail})`,
      { diagnosticCode: code, operation: "verify account locale switch" }
    );
  const failureKind = (cause: unknown) =>
    cause instanceof Error && cause.name === "TimeoutError"
      ? "timeout"
      : "error";
  try {
    try {
      await trigger(page, to);
    } catch (cause) {
      throw fail("account_locale_switch_trigger_failed", failureKind(cause));
    }

    let landingFailure: unknown;
    try {
      await page.waitForURL(
        (url) => url.pathname === accountProfilePath(to) && url.search === "",
        { timeout: workspaceE2ETimeouts.browserNavigation }
      );
      await waitForSelectedAccountSection(page, "profile", profileCopy(to));
    } catch (cause) {
      landingFailure = cause;
    }

    // The error page outranks a failed landing: it is the first thing the
    // switch got wrong.
    const errorPageAt = await page
      .evaluate(
        (key) => window.sessionStorage.getItem(key),
        localeSwitchErrorPageKey
      )
      .catch(() => null);
    if (errorPageAt) {
      throw fail(
        "account_locale_switch_error_page_shown",
        `the error page showed on ${errorPageAt}`
      );
    }
    if (landingFailure !== undefined) {
      throw fail(
        "account_locale_switch_landing_failed",
        failureKind(landingFailure)
      );
    }
    if (pageErrors.length > 0) {
      throw fail(
        "account_locale_switch_page_error",
        `${pageErrors.length} uncaught page errors, first: ${pageErrors[0]}`
      );
    }
  } finally {
    page.off("pageerror", recordPageError);
    await release();
    await page
      .evaluate((key) => {
        window.sessionStorage.removeItem(key);
      }, localeSwitchErrorPageKey)
      .catch(() => undefined);
  }
};

/**
 * Starting on the English profile, switches to Czech through the profile's
 * language control and back to English through the header switcher. Each
 * switch must land on the new locale's profile without the error page.
 * Both hold the save and the new document, so a render the save triggers on
 * the old page has time to show. The account ends with English saved, as
 * later serial cases expect.
 */
export async function verifyAccountLocaleSwitchTransition(
  page: Page,
  baseUrl: string
): Promise<void> {
  // Every document the tab loads arms its own watch while the key is set.
  await page.addInitScript(watchLocaleSwitchErrorPage, errorPageWatch);
  try {
    await page.goto(new URL(getAccountPath("en-US"), baseUrl).toString(), {
      timeout: workspaceE2ETimeouts.browserNavigation,
    });
    await selectAccountSection(page, "profile");
  } catch {
    throw workspaceE2EError(
      "The English account profile did not open before the locale switch",
      {
        diagnosticCode: "account_locale_switch_start_failed",
        operation: "verify account locale switch",
      }
    );
  }
  await verifyLocaleSwitch(page, {
    from: "en-US",
    to: "cs-CZ",
    trigger: chooseProfileLanguage,
  });
  await verifyLocaleSwitch(page, {
    from: "cs-CZ",
    to: "en-US",
    trigger: activateHeaderSwitcher,
  });
}
