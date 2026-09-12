import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AccountContentLoading, AccountLoading } from "./account-loading";
import { AccountShell, type AccountShellProps } from "./shell/account-shell";

const sectionKeys = [
  "reservations",
  "profile",
  "billing",
  "legal",
  "danger",
] as const;

type AccountSectionKey = (typeof sectionKeys)[number];

type LoadingCopy = {
  readonly accountTitle: string;
  readonly loadingMessage: string;
  readonly locale: "en-US" | "cs-CZ";
  readonly metadataTitle: string;
  readonly mobileSection: string;
  readonly navigation: string;
  readonly sections: Readonly<Record<AccountSectionKey, string>>;
  readonly signOut: string;
};

const localizedLoadingCopy: readonly LoadingCopy[] = [
  {
    accountTitle: "My Workspace",
    loadingMessage: "Loading content…",
    locale: "en-US",
    metadataTitle: "My account | Deskohub Workspace",
    mobileSection: "Account section",
    navigation: "Account navigation",
    sections: {
      billing: "Billing & Invoices",
      danger: "Danger zone",
      legal: "Legal & Privacy",
      profile: "Profile & Identity",
      reservations: "Reservations",
    },
    signOut: "Sign out",
  },
  {
    accountTitle: "Můj Workspace",
    loadingMessage: "Načítání obsahu…",
    locale: "cs-CZ",
    metadataTitle: "Můj účet | Deskohub Workspace",
    mobileSection: "Sekce účtu",
    navigation: "Navigace účtu",
    sections: {
      billing: "Fakturace a faktury",
      danger: "Nebezpečná zóna",
      legal: "Právní informace a soukromí",
      profile: "Profil a identita",
      reservations: "Rezervace",
    },
    signOut: "Odhlásit se",
  },
];

const shellLabels: AccountShellProps["labels"] = {
  mobileSection: "Account section",
  navigation: "Account navigation",
  sections: {
    billing: "Billing & Invoices",
    danger: "Danger zone",
    legal: "Legal & Privacy",
    profile: "Profile & Identity",
    reservations: "Reservations",
  },
};

class TestResizeObserver implements ResizeObserver {
  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  disconnect() {}

  observe(_target: Element) {}

  unobserve(_target: Element) {}
}

const originalResizeObserver = globalThis.ResizeObserver;

function getFrameStructure(container: HTMLElement) {
  const main = container.querySelector("main");
  const frameContent = main?.querySelector(":scope > div");
  const header = frameContent?.querySelector(":scope > header");
  const heading = header?.querySelector(":scope > h1");
  const grid = frameContent?.querySelector(":scope > div");
  const aside = grid?.querySelector(":scope > aside");
  const navigation = aside?.querySelector(":scope > nav");
  const content = grid?.querySelector(":scope > div");

  if (
    !main ||
    !frameContent ||
    !header ||
    !heading ||
    !grid ||
    !aside ||
    !navigation ||
    !content
  ) {
    throw new Error("Account frame structure was not rendered");
  }

  return [
    main,
    frameContent,
    header,
    heading,
    grid,
    aside,
    navigation,
    content,
  ].map((element) => ({
    className: element.className,
    tagName: element.tagName,
  }));
}

function renderShell() {
  return render(
    <AccountShell
      activeSection="reservations"
      disabledSections={sectionKeys}
      labels={shellLabels}
      onSectionChange={() => undefined}
      signOut={<div aria-hidden="true" />}
      title="Frame title"
    >
      <div data-testid="frame-content" />
    </AccountShell>
  );
}

describe("AccountLoading", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    globalThis.ResizeObserver = TestResizeObserver;
  });

  afterEach(cleanup);

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    unregisterWorkspaceComponentTestEnv();
  });

  test.each(localizedLoadingCopy)(
    "renders the localized account frame and disabled navigation for $locale",
    (copy) => {
      const view = render(<AccountLoading locale={copy.locale} />);
      const status = view.getByRole("status", { name: copy.metadataTitle });
      const loadingMessage = view.getByText(copy.loadingMessage);
      const navigation = view.getByRole("navigation", {
        name: copy.navigation,
      });

      expect(status.textContent).toContain(copy.loadingMessage);
      expect(loadingMessage.closest('[aria-busy="true"]')).toBeNull();
      expect(loadingMessage.closest('[aria-hidden="true"]')).toBeNull();
      expect(status.querySelector('[aria-busy="true"]')).toBeTruthy();
      expect(
        view.getByRole("heading", { level: 1, name: copy.accountTitle })
      ).toBeTruthy();
      expect(navigation.querySelector("fieldset")?.textContent).toContain(
        copy.mobileSection
      );

      for (const section of sectionKeys) {
        const buttons = Array.from(
          navigation.querySelectorAll("button")
        ).filter(
          (button) => button.textContent?.trim() === copy.sections[section]
        );
        expect(buttons).toHaveLength(2);
        for (const button of buttons) {
          expect(button.textContent?.trim()).toBe(copy.sections[section]);
          expect((button as HTMLButtonElement).disabled).toBe(true);
        }
      }

      const buttons = Array.from(view.container.querySelectorAll("button"));
      expect(buttons).toHaveLength(11);
      expect(buttons.every((button) => button.disabled)).toBe(true);
      expect(view.getByRole("button", { name: copy.signOut })).toHaveProperty(
        "disabled",
        true
      );
      expect(view.container.querySelector("span.ml-auto")).toBeNull();
      expect(
        view.container.querySelector("input, textarea, select, form")
      ).toBe(null);
      expect(view.container.textContent).not.toContain("@example");
      expect(
        status.querySelectorAll('[data-slot="skeleton"]').length
      ).toBeGreaterThan(0);
    }
  );

  test.each(localizedLoadingCopy)(
    "renders a content-only localized fallback for $locale",
    (copy) => {
      const view = render(<AccountContentLoading locale={copy.locale} />);
      const status = view.getByRole("status", { name: copy.metadataTitle });
      const loadingMessage = view.getByText(copy.loadingMessage);

      expect(status.textContent).toContain(copy.loadingMessage);
      expect(loadingMessage.className).toContain("sr-only");
      expect(loadingMessage.closest('[aria-busy="true"]')).toBeNull();
      expect(loadingMessage.closest('[aria-hidden="true"]')).toBeNull();
      expect(view.container.textContent).toContain(copy.loadingMessage);
      expect(status.querySelector('[aria-busy="true"]')).toBeTruthy();
      expect(
        status.querySelectorAll('[data-slot="skeleton"]').length
      ).toBeGreaterThan(0);
      expect(view.container.querySelector("main, header, nav, aside")).toBe(
        null
      );
      expect(view.container.querySelector("button, a, form, input")).toBeNull();
      expect(status.querySelector('[data-slot="card"]')).toBeNull();
    }
  );

  test("uses the AccountShell Frame geometry without duplicating it", () => {
    const shellView = renderShell();
    const expectedStructure = getFrameStructure(shellView.container);

    cleanup();

    const loadingView = render(<AccountLoading locale="en-US" />);

    expect(getFrameStructure(loadingView.container)).toEqual(expectedStructure);
  });
});
