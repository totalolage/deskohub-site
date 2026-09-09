import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type { Page } from "@playwright/test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, useState } from "react";
import { ProfileScreen } from "@/features/account/components/profile/profile-screen";
import {
  type AccountSection,
  AccountShell,
  type AccountShellProps,
} from "@/features/account/components/shell/account-shell";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { verifyAccountLayoutNavigation } from "./account-layout-navigation";
import { accountSectionLabels } from "./account-sections";

const sections = [
  "reservations",
  "profile",
  "billing",
  "legal",
  "danger",
] as const satisfies readonly AccountSection[];

const shellLabels = {
  mobileSection: "Account section",
  navigation: "Account navigation",
  sections: accountSectionLabels,
} as const satisfies AccountShellProps["labels"];

const profileCopy = {
  avatarUnavailableDescription: "Avatar unavailable",
  avatarUnavailableLabel: "Avatar unavailable",
  emailDescription: "Email cannot be changed",
  emailLabel: "Email",
  languageLabel: "Language",
  languageUnavailableDescription: "Language changes are unavailable",
  languageUnavailableValue: "English",
  memberFallback: "Member",
  title: "Profile & Identity",
  verifiedEmail: "Verified",
} as const;

const sectionPanel = (section: AccountSection) => {
  switch (section) {
    case "reservations":
      return createElement(
        "h2",
        { id: "account-reservations-current-title" },
        "Current and upcoming"
      );
    case "profile":
      return createElement(ProfileScreen, {
        copy: profileCopy,
        // ProfileScreen's typed createElement overload requires children in props.
        // biome-ignore lint/correctness/noChildrenProp: the required child must be present in the props object.
        children: createElement("input", { id: "account-profile-first-name" }),
        email: "synthetic@example.test",
        firstName: "E2E",
        lastName: null,
      });
    case "billing":
      return createElement(
        "section",
        { "aria-labelledby": "account-billing-title" },
        createElement(
          "h2",
          { id: "account-billing-title" },
          "Billing & Invoices"
        ),
        createElement("select", { id: "account-profile-billing-kind" })
      );
    case "legal":
      return createElement(
        "a",
        { href: "/en-US/privacy-policy" },
        "Privacy policy"
      );
    case "danger":
      return createElement(
        "button",
        { id: "delete-account-trigger", type: "button" },
        "Delete account"
      );
  }
};

function AccountShellHarness() {
  const [activeSection, setActiveSection] =
    useState<AccountSection>("reservations");

  return createElement(
    AccountShell,
    {
      activeSection,
      // AccountShell receives the rendered panels as variadic children below.
      // biome-ignore lint/correctness/noChildrenProp: AccountShellProps requires children in this createElement call.
      children: null,
      labels: shellLabels,
      onSectionChange: setActiveSection,
      signOut: createElement("button", { type: "button" }, "Sign out"),
      title: "Workspace account",
    },
    ...sections.map((section) =>
      createElement(
        "div",
        { hidden: activeSection !== section, key: section },
        sectionPanel(section)
      )
    )
  );
}

type FakeLocator = {
  readonly click: () => Promise<void>;
  readonly isVisible: () => Promise<boolean>;
  readonly selectOption: (value: string) => Promise<readonly string[]>;
  readonly waitFor: (options?: { readonly state?: string }) => Promise<void>;
};

const elementIsVisible = (element: Element): boolean => {
  for (
    let current: Element | null = element;
    current !== null;
    current = current.parentElement
  ) {
    if (current.hasAttribute("hidden")) return false;
    const styles = window.getComputedStyle(current);
    if (styles.display === "none" || styles.visibility === "hidden") {
      return false;
    }
  }
  return true;
};

const fakeLocator = (element: Element): FakeLocator => ({
  click: async () => {
    if (!elementIsVisible(element)) throw new Error("fake target is hidden");
    fireEvent.click(element);
  },
  isVisible: async () => elementIsVisible(element),
  selectOption: async (value) => {
    if (!elementIsVisible(element)) throw new Error("fake target is hidden");
    fireEvent.change(element, { target: { value } });
    return [value];
  },
  waitFor: async (options = {}) => {
    if (options.state === "visible" && !elementIsVisible(element))
      throw new Error("fake target did not become visible");
  },
});

const makeFakePage = (): Page => {
  let viewport = { height: 900, width: 1024 };
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: viewport.width,
  });

  const getByRole = (
    role: "button" | "combobox",
    options: { readonly exact?: boolean; readonly name?: string } = {}
  ) => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        role === "button" ? "button" : "select"
      )
    );
    const name = options.name ?? "";
    const exact = options.exact !== false;
    const element = candidates.find((candidate) => {
      const accessibleName =
        role === "combobox"
          ? (Array.from(document.querySelectorAll("label"))
              .find((label) => label.htmlFor === candidate.id)
              ?.textContent?.trim() ?? "")
          : (candidate.textContent?.replaceAll(/\s+/g, " ").trim() ?? "");
      return exact ? accessibleName === name : accessibleName.includes(name);
    });
    if (!element) throw new Error(`fake ${role} target was not found`);
    return fakeLocator(element);
  };

  const page = Object.assign({} as Page, {
    evaluate: async (pageFunction: unknown, arg: unknown) => {
      if (typeof pageFunction !== "function")
        throw new Error("fake evaluate target was not a function");
      return (pageFunction as (value: unknown) => unknown)(arg);
    },
    getByRole,
    locator: (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`fake locator was not found: ${selector}`);
      return fakeLocator(element);
    },
    setViewportSize: async (nextViewport: {
      height: number;
      width: number;
    }) => {
      viewport = { ...nextViewport };
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: viewport.width,
      });
    },
    viewportSize: () => viewport,
    waitForFunction: async (pageFunction: unknown, arg: unknown) => {
      if (typeof pageFunction !== "function")
        throw new Error("fake wait predicate was not a function");
      if (!(pageFunction as (value: unknown) => boolean)(arg))
        throw new Error("fake account section did not settle");
    },
  });

  return page;
};

const installLayoutGeometry = (): (() => void) => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const originalScrollWidth = Object.getOwnPropertyDescriptor(
    document.documentElement,
    "scrollWidth"
  );
  Object.defineProperty(document.documentElement, "scrollWidth", {
    configurable: true,
    get: () => window.innerWidth,
  });
  Element.prototype.getBoundingClientRect = function () {
    const navigation = document.querySelector(
      'nav[aria-label="Account navigation"]'
    );
    const aside = navigation?.closest("aside");
    const grid = aside?.parentElement;
    const content =
      aside && grid
        ? Array.from(grid.children).find((child) => child !== aside)
        : undefined;
    const makeRect = (
      left: number,
      top: number,
      width: number,
      height: number
    ) =>
      ({
        bottom: top + height,
        height,
        left,
        right: left + width,
        top,
        width,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    if (this === navigation) return makeRect(16, 200, 264, 400);
    if (this === aside) return makeRect(16, 200, 264, 600);
    if (this === content) return makeRect(312, 200, 1_100, 600);
    return makeRect(0, 0, 100, 20);
  };

  return () => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalScrollWidth) {
      Object.defineProperty(
        document.documentElement,
        "scrollWidth",
        originalScrollWidth
      );
    } else {
      delete (document.documentElement as { scrollWidth?: number }).scrollWidth;
    }
  };
};

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("navigates every rendered account section across desktop and mobile layouts", async () => {
  const restoreLayoutGeometry = installLayoutGeometry();
  try {
    render(createElement(AccountShellHarness));
    let capturedSections: readonly AccountSection[] = [];

    await verifyAccountLayoutNavigation(makeFakePage(), async (section) => {
      capturedSections = [...capturedSections, section];
    });

    expect(capturedSections).toEqual(sections);
  } finally {
    restoreLayoutGeometry();
  }
});
