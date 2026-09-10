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
import { legalScreenCopy } from "./legal-screen.copy";

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

const { CookieConsentProvider } = await import(
  "@/features/cookie-consent/components/cookie-consent-provider"
);
const { LegalScreen } = await import("./legal-screen");

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
      <LegalScreen locale={locale} strings={legalScreenCopy[locale]} />
    </>
  );
}

for (const locale of ["en-US", "cs-CZ"] as const) {
  test(`${locale} renders the supplied copy and localized policy destinations`, () => {
    const strings = legalScreenCopy[locale];
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
  const strings = legalScreenCopy[locale];
  const view = renderLegalScreen(locale);
  const checkboxFor = (title: string) =>
    view.getByRole("checkbox", { name: new RegExp(`^${title}`) });

  const necessary = checkboxFor(m.cookieSettingsNecessaryTitle({}, { locale }));
  const analytics = checkboxFor(m.cookieSettingsAnalyticsTitle({}, { locale }));
  const marketing = checkboxFor(m.cookieSettingsMarketingTitle({}, { locale }));
  const preferences = checkboxFor(
    m.cookieSettingsPreferencesTitle({}, { locale })
  );

  expect(necessary.getAttribute("aria-checked")).toBe("true");
  expect((necessary as HTMLButtonElement).disabled).toBe(true);
  expect(
    view.queryByRole("button", { name: strings.savePreferences })
  ).toBeNull();
  expect(view.queryByText(strings.preferencesUnavailable)).toBeNull();
  for (const checkbox of [analytics, marketing, preferences]) {
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect((checkbox as HTMLButtonElement).disabled).toBe(false);
  }

  fireEvent.click(analytics);
  await waitFor(() => {
    expect(analytics.getAttribute("aria-checked")).toBe("true");
  });

  fireEvent.click(analytics);
  await waitFor(() => {
    expect(analytics.getAttribute("aria-checked")).toBe("false");
  });

  fireEvent.click(
    view.getByRole("button", {
      name: m.cookieSettingsAcceptAll({}, { locale }),
    })
  );
  await waitFor(() => {
    for (const checkbox of [analytics, marketing, preferences]) {
      expect(checkbox.getAttribute("aria-checked")).toBe("true");
    }
  });

  fireEvent.click(
    view.getByRole("button", {
      name: m.cookieSettingsRejectAll({}, { locale }),
    })
  );
  await waitFor(() => {
    expect(necessary.getAttribute("aria-checked")).toBe("true");
    for (const checkbox of [analytics, marketing, preferences]) {
      expect(checkbox.getAttribute("aria-checked")).toBe("false");
    }
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

  const actions = view.getByRole("button", {
    name: m.cookieSettingsAcceptAll({}, { locale: "en-US" }),
  }).parentElement;
  expect(actions?.className).toContain("flex-wrap");
  expect(actions?.className).toContain("min-w-0");
});
