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
import { AccountLoading } from "./account-loading";

const sectionKeys = [
  "reservations",
  "profile",
  "assistants",
  "billing",
  "legal",
  "danger",
] as const;

type AccountSectionKey = (typeof sectionKeys)[number] | "referrals";

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
      assistants: "Connected assistants",
      referrals: "Referrals",
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
      assistants: "Připojení asistenti",
      referrals: "Doporučení",
      reservations: "Rezervace",
    },
    signOut: "Odhlásit se",
  },
];

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

describe("AccountLoading", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    globalThis.ResizeObserver = TestResizeObserver;
  });

  afterEach(cleanup);

  afterAll(async () => {
    globalThis.ResizeObserver = originalResizeObserver;
    await unregisterWorkspaceComponentTestEnv();
  });

  test.each(localizedLoadingCopy)(
    "renders the localized account frame and disabled navigation without the referral section for $locale",
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

      expect(navigation.textContent).not.toContain(copy.sections.referrals);
      const buttons = Array.from(view.container.querySelectorAll("button"));
      expect(buttons).toHaveLength(sectionKeys.length * 2 + 1);
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
});
