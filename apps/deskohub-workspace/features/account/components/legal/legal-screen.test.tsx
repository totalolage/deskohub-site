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

mock.module("@/features/legal/components/marketing-preferences-form", () => ({
  MarketingPreferencesForm: ({
    accountsEnabled,
    state,
  }: {
    readonly accountsEnabled?: boolean;
    readonly state: { readonly status: string };
  }) => (
    <section
      data-marketing-preferences-accounts-enabled={String(accountsEnabled)}
      data-testid="legal-marketing-preferences"
    >
      {state.status}
    </section>
  ),
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
const { getLegalScreenStrings } = await import("../account-screen-copy");

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  acceptedCategories = ["necessary"];
  onConsentChange = undefined;
});
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

function renderLegalScreen(locale: Locale) {
  return render(
    <>
      <CookieConsentProvider locale={locale} />
      <LegalScreen locale={locale} strings={getLegalScreenStrings(locale)} />
    </>
  );
}

for (const locale of ["en-US", "cs-CZ"] as const) {
  test(`${locale} renders the supplied copy and localized policy destinations`, () => {
    const strings = getLegalScreenStrings(locale);
    const view = renderLegalScreen(locale);

    expect(
      view.getByRole("heading", { level: 2, name: strings.title })
    ).toBeTruthy();
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
        name: strings.archiveTitle,
      })
    ).toBeTruthy();
    expect(view.getByText(strings.archiveDescription)).toBeTruthy();
    const archiveAction = view.getByRole("button", {
      name: strings.archiveAction,
    });
    expect((archiveAction as HTMLButtonElement).disabled).toBe(true);
    expect(archiveAction.getAttribute("type")).toBe("button");
  });
}

test("renders immutable necessary consent and functional optional controls", async () => {
  const locale = "en-US" as const;
  const strings = getLegalScreenStrings(locale);
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
    view.queryByRole("button", { name: strings.savePreferences })
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
  expect(view.queryByRole("button", { name: strings.unavailable })).toBeNull();
  expect(view.queryByText(strings.analyticsDescription)).toBeNull();
  expect(view.queryByText(strings.marketingDescription)).toBeNull();
  expect(view.queryByText(strings.preferencesUnavailable)).toBeNull();

  const archiveAction = view.getByRole("button", {
    name: strings.archiveAction,
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

test("renders the marketing preferences block inside the shared cookie settings rows", () => {
  const view = renderLegalScreen("en-US");

  const marketing = view.getByTestId("legal-marketing-preferences");
  // The rows live in the shared preference-row group and the marketing block
  // follows it as the last child of the same cookie settings container.
  // Compare nodes with `===` so a regression fails fast; bun's toBe failure
  // diff serializes the entire happy-dom subtree and stalls the suite.
  const group = marketing.previousElementSibling;
  expect(group?.getAttribute("data-slot")).toBe("preference-row-group");
  expect(group?.querySelectorAll('[data-slot="preference-row"]').length).toBe(
    4
  );
  expect(marketing.parentElement?.lastElementChild === marketing).toBe(true);
});

test("defaults the optional marketing preference state to unavailable", () => {
  const view = renderLegalScreen("en-US");

  expect(view.getByTestId("legal-marketing-preferences").textContent).toBe(
    "unavailable"
  );
});

test("passes account availability to the marketing preference form", () => {
  const view = render(
    <>
      <CookieConsentProvider locale="en-US" />
      <LegalScreen
        accountsEnabled={false}
        locale="en-US"
        strings={getLegalScreenStrings("en-US")}
      />
    </>
  );

  expect(
    view
      .getByTestId("legal-marketing-preferences")
      .getAttribute("data-marketing-preferences-accounts-enabled")
  ).toBe("false");
});

test("passes the rendered marketing preference state through", async () => {
  const view = render(
    <>
      <CookieConsentProvider locale="cs-CZ" />
      <LegalScreen
        locale="cs-CZ"
        marketingPreferences={{
          context: "synthetic-link-context",
          source: "link",
          status: "active",
        }}
        strings={getLegalScreenStrings("cs-CZ")}
      />
    </>
  );

  expect(view.getByTestId("legal-marketing-preferences").textContent).toBe(
    "active"
  );
});
