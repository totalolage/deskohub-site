import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ComponentPropsWithoutRef, Ref } from "react";
import { useState } from "react";
import { type Locale, m } from "@/features/i18n";
import {
  flushWorkspaceComponentWork,
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
  useVisitorConsent: (category: string) =>
    acceptedCategories.includes(category),
  visitorConsent: {
    accept: (category: string) => {
      acceptedCategories = [...new Set(getAcceptedCategories(category))];
      onConsentChange?.();
    },
    accepts: (category: string) => acceptedCategories.includes(category),
    reject: (category: string) => {
      acceptedCategories = acceptedCategories.filter(
        (accepted) => accepted !== category
      );
      onConsentChange?.();
    },
    subscribe: () => () => undefined,
  },
}));

const { ConsentBanner } = await import(
  "@/features/cookie-consent/components/consent-banner"
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
afterAll(async () => {
  cleanup();
  await flushWorkspaceComponentWork();
  await unregisterWorkspaceComponentTestEnv();
});

function renderLegalScreen(locale: Locale) {
  return render(
    <>
      <ConsentBanner locale={locale} />
      <LegalScreen locale={locale} />
    </>
  );
}

const linkMarketingState = {
  context: "synthetic-link-context",
  dismissalContext: "synthetic-link-dismissal-context",
  source: "link",
  status: "active",
} as const;

test.each(["en-US", "cs-CZ"] as const)(
  "renders five peer preference rows with the marketing feedback inside the fifth card in %s",
  (locale) => {
    const view = render(
      <>
        <ConsentBanner locale={locale} />
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

    // The group's DOM children are EXACTLY the five row cards: the four
    // cookie categories followed by the managed marketing messages row.
    // Fragments flatten, so no sixth sibling (feedback or wrapper) may appear,
    // even while a save is in flight or after success/error.
    const rows = Array.from(group.children);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.tagName.toLowerCase()).toBe("article");
      expect(row.getAttribute("data-slot")).toBe("preference-row");
      expect(row.parentElement === group).toBe(true);
    }

    const rowTitles = rows.map((row) => row.querySelector("h3")?.textContent);
    expect(rowTitles).toEqual([
      m.cookieSettingsNecessaryTitle({}, { locale }),
      m.cookieSettingsAnalyticsTitle({}, { locale }),
      m.cookieSettingsMarketingTitle({}, { locale }),
      m.cookieSettingsPreferencesTitle({}, { locale }),
      m.marketingPreferencesFormRowTitle({}, { locale }),
    ]);

    // Peer rows: every heading inside the group is an h3 — no h2 row headings.
    expect(group.querySelector("h2")).toBeNull();

    // The marketing row itself carries the state markers: semantically they
    // describe that row, not an outer shell.
    const marketingRow = rows[4];
    expect(marketingRow.getAttribute("data-marketing-preferences")).toBe(
      "active"
    );
    expect(marketingRow.getAttribute("data-marketing-preferences-source")).toBe(
      "link"
    );

    // Marketing feedback lives inside the fifth card's support column, never
    // as a loose group item or reserved blank space outside the cards.
    const feedback = group.querySelector("#marketing-preferences-feedback");
    expect(feedback).toBeTruthy();
    expect(marketingRow.contains(feedback)).toBe(true);
    expect(Array.from(group.children).includes(feedback)).toBe(false);
    expect(group.querySelector(":scope > section")).toBeNull();

    // Panel title and row headings keep their peer semantics.
    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.legalScreenTitle({}, { locale }),
      })
    ).toBeTruthy();

    // The marketing switch is present and interactive inside the group.
    const marketingSwitch = view.getByRole("switch", {
      name: m.marketingPreferencesFormRowTitle({}, { locale }),
    });
    expect(marketingSwitch.getAttribute("aria-checked")).toBe("true");
    expect((marketingSwitch as HTMLButtonElement).disabled).toBe(false);

    // The archive block stays outside the preference group at its own level.
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

  const group = view.container.querySelector(
    '[data-slot="preference-row-group"]'
  );
  expect(group).toBeTruthy();
  expect(group.children).toHaveLength(4);

  // The unavailable state renders as separately spaced content outside the
  // row group, with its markers on the fallback root itself.
  const fallback = view.container.querySelector(
    '[data-marketing-preferences="unavailable"]'
  );
  expect(fallback).toBeTruthy();
  expect(group.contains(fallback)).toBe(false);
  expect(fallback.getAttribute("data-marketing-preferences-source")).toBe(null);
  expect(
    view
      .getByRole("link", {
        name: m.marketingPreferencesFormSignInAction({}, { locale }),
      })
      .getAttribute("href")
  ).toBe("/en-US/auth/sign-in");
});
