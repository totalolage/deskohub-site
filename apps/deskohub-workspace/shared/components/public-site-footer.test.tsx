import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import type { LocalePreferenceSaving } from "@/features/account/switch-locale";
import { type Locale, m } from "@/features/i18n";
import { languageNames } from "@/features/i18n/language-labels";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { workspaceSiteConstants } from "@/shared/utils";

const guardedLinkHrefs: string[] = [];

mock.module("next/cache", () => ({ cacheLife: () => undefined }));
mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: () => Promise.resolve("cs-CZ"),
}));
mock.module("next/navigation", () => ({
  usePathname: () => "/cs-CZ/pricing",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/shared/components/guarded-link", () => ({
  GuardedLink: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly href: string | URL;
    readonly prefetch?: boolean | "auto" | null;
  }) => {
    guardedLinkHrefs.push(href.toString());

    return (
      <a href={href.toString()} {...props}>
        {children}
      </a>
    );
  },
}));

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  guardedLinkHrefs.length = 0;
});
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

// The layout passes the header's preference saving; most tests need a guest's.
const guestPreference: LocalePreferenceSaving = {
  signedIn: Promise.resolve(false),
  save: () => Promise.resolve(),
};

const languageNavigationLabel = m.languageSwitcherLabel(
  {},
  { locale: "cs-CZ" }
);

const renderFooter = async (localePreference = guestPreference) => {
  const { PublicSiteFooter } = await import("./public-site-footer");
  const footer = await PublicSiteFooter({ localePreference });
  // The language links settle the session check right after the render.
  return act(async () => render(footer));
};

test("advances the copyright year at the Prague new year", async () => {
  // 23:30 UTC on 31 December is already 00:30 on 1 January in Prague.
  setSystemTime(new Date("2026-12-31T23:30:00Z"));
  try {
    const view = await renderFooter();

    expect(
      view.getByText(
        m.footerCopyright(
          {
            companyName: workspaceSiteConstants.brand.legalName,
            year: "2027",
          },
          { locale: "cs-CZ" }
        )
      )
    ).toBeTruthy();
  } finally {
    setSystemTime();
  }
});

test("routes every internal footer page link through a locale-prefixed guarded link", async () => {
  const view = await renderFooter();
  // Language links switch locale with a document navigation, not a guarded
  // in-app link.
  const languageNavigation = view.getByRole("navigation", {
    name: languageNavigationLabel,
  });
  const internalPageHrefs = Array.from(
    view.container.querySelectorAll('a[href^="/"]:not([download])')
  )
    .filter((link) => !languageNavigation.contains(link))
    .map((link) => link.getAttribute("href"));

  expect(internalPageHrefs.length).toBeGreaterThan(0);
  expect<readonly (string | null)[]>(guardedLinkHrefs).toEqual(
    internalPageHrefs
  );
  for (const href of guardedLinkHrefs) {
    expect(href === "/cs-CZ" || href.startsWith("/cs-CZ/")).toBe(true);
  }
});

test("links the prices and opening hours page", async () => {
  const view = await renderFooter();

  expect(
    view
      .getByRole("link", {
        name: m.footerPricingLink({}, { locale: "cs-CZ" }),
      })
      .getAttribute("href")
  ).toBe("/cs-CZ/pricing");
});

test("links the Android app page for crawlers and visitors without scripts", async () => {
  const view = await renderFooter();

  expect(
    view.getAllByRole("link").map((link) => link.getAttribute("href"))
  ).toContain("/cs-CZ/android");
});

test("names every language in itself and links all but the current one to this page", async () => {
  const view = await renderFooter();
  const languages = view.getByRole("navigation", {
    name: languageNavigationLabel,
  });
  const displayOrder: readonly Locale[] = [
    "cs-CZ",
    "en-US",
    "de-DE",
    "uk-UA",
    "sk-SK",
    "vi-VN",
    "hi-IN",
  ];

  expect(
    within(languages)
      .getAllByRole("listitem")
      .map((item) => item.textContent)
  ).toEqual(displayOrder.map((locale) => languageNames[locale]));
  const current = within(languages).getByText(languageNames["cs-CZ"]);
  expect(current.getAttribute("aria-current")).toBe("true");
  expect(current.getAttribute("lang")).toBe("cs-CZ");
  expect(current.closest("a")).toBeNull();
  for (const locale of displayOrder.slice(1)) {
    const link = within(languages).getByRole("link", {
      name: languageNames[locale],
    });
    expect(link.getAttribute("href")).toBe(`/${locale}/pricing`);
    expect(link.getAttribute("lang")).toBe(locale);
    expect(link.getAttribute("hrefLang")).toBe(locale);
    expect(link.hasAttribute("aria-current")).toBe(false);
  }
});

test("saves a signed-in customer's preference before a language link navigates", async () => {
  window.location.href = "http://localhost/cs-CZ/pricing";
  const saves: { readonly locale: string }[] = [];
  const saved = Promise.withResolvers<void>();
  const view = await renderFooter({
    signedIn: Promise.resolve(true),
    save: (input) => {
      saves.push(input);
      return saved.promise;
    },
  });

  fireEvent.click(
    within(
      view.getByRole("navigation", { name: languageNavigationLabel })
    ).getByRole("link", { name: languageNames["en-US"] })
  );

  await waitFor(() => expect(saves).toEqual([{ locale: "en-US" }]));
  expect(window.location.pathname).toBe("/cs-CZ/pricing");

  await act(async () => {
    saved.resolve();
    await saved.promise;
  });

  expect(window.location.pathname).toBe("/en-US/pricing");
});
