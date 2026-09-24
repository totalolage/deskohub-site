import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentPropsWithoutRef, Ref } from "react";
import { useState } from "react";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type MockNextLinkProps = ComponentPropsWithoutRef<"a"> & {
  readonly href: string;
  readonly onNavigate?: (event: { preventDefault: () => void }) => void;
  readonly prefetch?: boolean | "auto" | null;
  readonly ref?: Ref<HTMLAnchorElement>;
};

function MockNextLink({
  children,
  href,
  onNavigate: _onNavigate,
  prefetch: _prefetch,
  ref,
  ...props
}: MockNextLinkProps) {
  return (
    <a href={href} ref={ref} {...props}>
      {children}
    </a>
  );
}

mock.module("next/link", () => ({ default: MockNextLink }));

// The real MarketingPreferencesForm renders inside the screen so the suite
// can observe the actual composed preference group; stub its server seam the
// same way marketing-preferences-form.test.tsx does.
const routerRefresh = mock(() => undefined);

type MarketingActionInput = { readonly context: string };
type MarketingActionResult = { readonly data?: unknown };

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

mock.module("@/features/legal/actions", () => ({
  clearMarketingManagementAction: (_input: MarketingActionInput) =>
    Promise.resolve<MarketingActionResult>({ data: { status: "cleared" } }),
  confirmMarketingManagementAction: (_input: MarketingActionInput) =>
    Promise.resolve<MarketingActionResult>({ data: { status: "confirmed" } }),
  saveMarketingPreferencesAction: (_input: MarketingActionInput) =>
    Promise.resolve<MarketingActionResult>({ data: { status: "saved" } }),
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    _action: (input: MarketingActionInput) => Promise<MarketingActionResult>,
    _options: Record<string, never>
  ) => {
    const [isExecuting, setIsExecuting] = useState(false);
    const execute = (input: MarketingActionInput) => {
      setIsExecuting(true);
      void Promise.resolve().then(() => setIsExecuting(false));
      return input;
    };
    return { execute, isExecuting, reset: () => undefined, result: {} };
  },
}));

let acceptedCategories = ["necessary"];
let onConsentChange: (() => void) | undefined;

function getAcceptedCategories(categories: string | string[]) {
  if (categories === "all") {
    return ["necessary", "analytics", "marketing", "preferences"];
  }
  if (categories === "necessary") return ["necessary"];
  if (Array.isArray(categories)) {
    return [
      "necessary",
      ...categories.filter((category) => category !== "necessary"),
    ];
  }

  return ["necessary", categories];
}

mock.module("vanilla-cookieconsent", () => ({
  acceptCategory: (categories: string | string[]) => {
    acceptedCategories = [...new Set(getAcceptedCategories(categories))];
    onConsentChange?.();
  },
  acceptedCategory: (category: string) => acceptedCategories.includes(category),
  getUserPreferences: () => ({ acceptedCategories }),
  run: (config: { onChange?: () => void }) => {
    onConsentChange = config.onChange;
    return Promise.resolve();
  },
  showPreferences: () => undefined,
}));

// Register the consent hook explicitly so this suite cannot inherit another
// test file's `@/features/cookie-consent` mock when bun collects suites in
// one process; the hook delegates to the same state the provider mock above
// drives.
mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({
    acceptCategory: (category: string) => {
      acceptedCategories = [...new Set(getAcceptedCategories(category))];
      onConsentChange?.();
    },
    isAccepted: (category: string) => acceptedCategories.includes(category),
    rejectCategory: (category: string) => {
      acceptedCategories = acceptedCategories.filter(
        (accepted) => accepted !== category
      );
      onConsentChange?.();
    },
  }),
}));

const { CookieConsentProvider } = await import(
  "@/features/cookie-consent/components/cookie-consent-provider"
);
const { LegalScreen } = await import("./legal-screen");

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  acceptedCategories = ["necessary"];
  onConsentChange = undefined;
});
afterEach(() => {
  cleanup();
  routerRefresh.mockClear();
});
afterAll(unregisterWorkspaceComponentTestEnv);

function renderLegalScreen(locale: Locale) {
  return render(
    <>
      <CookieConsentProvider locale={locale} />
      <LegalScreen locale={locale} />
    </>
  );
}

for (const locale of ["en-US", "cs-CZ"] as const) {
  test(`${locale} renders the catalog copy and localized policy destinations`, () => {
    const view = renderLegalScreen(locale);
    const title = m.legalScreenTitle({}, { locale });

    expect(view.getByRole("heading", { level: 2, name: title })).toBeTruthy();
    expect(
      view.getByRole("navigation", {
        name: m.footerLegalLabel({}, { locale }),
      })
    ).toBeTruthy();

    const policyLinks = [
      [m.footerPrivacyLink({}, { locale }), `/${locale}/privacy-policy`],
      [
        m.footerMarketingCommunicationsLink({}, { locale }),
        `/${locale}/marketing-communications`,
      ],
      [m.footerTermsLink({}, { locale }), `/${locale}/terms-and-conditions`],
      [m.footerCookiePolicyLink({}, { locale }), `/${locale}/cookie-policy`],
    ] as const;

    for (const [name, href] of policyLinks) {
      expect(view.getByRole("link", { name }).getAttribute("href")).toBe(href);
    }

    expect(
      view.getByRole("heading", {
        level: 3,
        name: m.legalScreenArchiveTitle({}, { locale }),
      })
    ).toBeTruthy();
    expect(
      view.getByText(m.legalScreenArchiveDescription({}, { locale }))
    ).toBeTruthy();
    const archiveAction = view.getByRole("button", {
      name: m.legalScreenArchiveAction({}, { locale }),
    });
    expect((archiveAction as HTMLButtonElement).disabled).toBe(true);
    expect(archiveAction.getAttribute("type")).toBe("button");
  });
}

test("renders immutable necessary consent and functional optional controls", async () => {
  const locale = "en-US" as const;
  const view = renderLegalScreen(locale);
  const switchFor = (title: string) =>
    view.getByRole("switch", { name: new RegExp(`^${title}`) });

  const necessary = switchFor(m.cookieSettingsNecessaryTitle({}, { locale }));
  const analytics = switchFor(m.cookieSettingsAnalyticsTitle({}, { locale }));
  const marketing = switchFor(m.cookieSettingsMarketingTitle({}, { locale }));
  const preferences = switchFor(
    m.cookieSettingsPreferencesTitle({}, { locale })
  );

  expect(necessary.getAttribute("aria-checked")).toBe("true");
  expect((necessary as HTMLButtonElement).disabled).toBe(true);
  expect(
    view.queryByRole("button", {
      name: m.legalScreenSavePreferences({}, { locale }),
    })
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: m.cookieSettingsAcceptAll({}, { locale }),
    })
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: m.cookieSettingsRejectAll({}, { locale }),
    })
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: m.legalScreenUnavailable({}, { locale }),
    })
  ).toBeNull();
  expect(
    view.queryByText(m.legalScreenAnalyticsDescription({}, { locale }))
  ).toBeNull();
  expect(
    view.queryByText(m.legalScreenMarketingDescription({}, { locale }))
  ).toBeNull();
  expect(
    view.queryByText(m.legalScreenPreferencesUnavailable({}, { locale }))
  ).toBeNull();

  const archiveAction = view.getByRole("button", {
    name: m.legalScreenArchiveAction({}, { locale }),
  });
  expect(archiveAction.closest("[role='group'][tabindex='0']")).not.toBeNull();
  expect(
    view.container.querySelectorAll("[role='group'][tabindex='0']")
  ).toHaveLength(1);

  for (const optionalSwitch of [analytics, marketing, preferences]) {
    expect(optionalSwitch.getAttribute("aria-checked")).toBe("false");
    expect((optionalSwitch as HTMLButtonElement).disabled).toBe(false);
  }

  fireEvent.click(analytics);
  await waitFor(() => {
    expect(analytics.getAttribute("aria-checked")).toBe("true");
  });

  fireEvent.click(analytics);
  await waitFor(() => {
    expect(analytics.getAttribute("aria-checked")).toBe("false");
  });

  fireEvent.click(marketing);
  await waitFor(() => {
    expect(marketing.getAttribute("aria-checked")).toBe("true");
  });
});

test("keeps consent controls wrapped and free of page-only shells", () => {
  const view = renderLegalScreen("en-US");

  expect(view.container.querySelector("main")).toBeNull();
  expect(view.container.querySelector("h1")).toBeNull();
  expect(view.container.querySelectorAll("article")).toHaveLength(4);

  for (const category of view.container.querySelectorAll("article")) {
    expect(category.className).toContain("min-w-0");
    expect(category.querySelector("p")?.className).toContain("break-words");
  }
});

const linkMarketingState = {
  context: "synthetic-link-context",
  dismissalContext: "synthetic-link-dismissal-context",
  source: "link",
  status: "active",
} as const;

test.each(["en-US", "cs-CZ"] as const)(
  "renders the marketing messages row inside the cookie settings preference group in %s",
  (locale) => {
    const view = render(
      <>
        <CookieConsentProvider locale={locale} />
        <LegalScreen
          locale={locale}
          marketingPreferences={{ ...linkMarketingState }}
        />
      </>
    );

    const group = view.container.querySelector(
      '[data-slot="preference-row-group"]'
    );
    expect(group).toBeTruthy();

    // One coherent group: the four cookie category rows followed by the
    // marketing messages row as the fifth item. Compare nodes with `===`
    // (booleans) so a regression fails fast; bun's toBe failure diff
    // serializes the entire happy-dom subtree and stalls the suite.
    const rows = Array.from(
      group.querySelectorAll('[data-slot="preference-row"]')
    );
    expect(rows).toHaveLength(5);
    expect(group.children).toHaveLength(5);
    const rowTitles = rows.map(
      (row) => row.querySelector("h2, h3")?.textContent
    );
    expect(rowTitles.slice(0, 4)).toEqual([
      m.cookieSettingsNecessaryTitle({}, { locale }),
      m.cookieSettingsAnalyticsTitle({}, { locale }),
      m.cookieSettingsMarketingTitle({}, { locale }),
      m.cookieSettingsPreferencesTitle({}, { locale }),
    ]);
    expect(rowTitles[4]).toBe(
      m.marketingPreferencesFormRowTitle({}, { locale })
    );

    // The marketing section is a direct child of the group and no longer
    // carries its own sibling separation margin.
    const marketingSection = group.querySelector(
      ":scope > section[data-marketing-preferences]"
    );
    expect(marketingSection).toBeTruthy();
    expect(marketingSection.getAttribute("data-marketing-preferences")).toBe(
      "active"
    );
    expect(
      marketingSection.getAttribute("data-marketing-preferences-source")
    ).toBe("link");
    expect(marketingSection.className).not.toContain("mt-8");
    expect(
      marketingSection.querySelector('[data-slot="preference-row"]') === rows[4]
    ).toBe(true);

    // The marketing switch is present and interactive inside the group.
    const marketingSwitch = view.getByRole("switch", {
      name: m.marketingPreferencesFormRowTitle({}, { locale }),
    });
    expect(marketingSwitch.getAttribute("aria-checked")).toBe("true");
    expect((marketingSwitch as HTMLButtonElement).disabled).toBe(false);

    // The archive block stays outside the preference group.
    const archiveHeading = view.getByRole("heading", {
      level: 3,
      name: m.legalScreenArchiveTitle({}, { locale }),
    });
    expect(group.contains(archiveHeading)).toBe(false);
  }
);

test("defaults the optional marketing preference state to unavailable", () => {
  const locale = "en-US" as const;
  const view = renderLegalScreen(locale);

  const section = view.container.querySelector(
    '[data-marketing-preferences="unavailable"]'
  );
  expect(section).toBeTruthy();
  expect(
    view
      .getByRole("link", {
        name: m.marketingPreferencesFormSignInAction({}, { locale }),
      })
      .getAttribute("href")
  ).toBe("/en-US/auth/sign-in");
});

test("hides the marketing sign-in affordance when accounts are disabled", () => {
  const locale = "en-US" as const;
  const view = render(
    <>
      <CookieConsentProvider locale={locale} />
      <LegalScreen accountsEnabled={false} locale={locale} />
    </>
  );

  expect(
    view.queryByRole("link", {
      name: m.marketingPreferencesFormSignInAction({}, { locale }),
    })
  ).toBeNull();
});

test("passes the rendered marketing preference state through", () => {
  const locale = "cs-CZ" as const;
  const view = render(
    <>
      <CookieConsentProvider locale={locale} />
      <LegalScreen
        locale={locale}
        marketingPreferences={{ ...linkMarketingState }}
      />
    </>
  );

  expect(
    view.container
      .querySelector('[data-marketing-preferences="active"]')
      ?.getAttribute("data-marketing-preferences-source")
  ).toBe("link");
  expect(
    view
      .getByRole("switch", {
        name: m.marketingPreferencesFormRowTitle({}, { locale }),
      })
      .getAttribute("aria-checked")
  ).toBe("true");
});
