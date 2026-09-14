import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import type { Page } from "@playwright/test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, useState } from "react";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
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
import { WorkspaceE2EError } from "../errors";
import {
  accountLayoutNavigationPhases,
  runAccountLayoutNavigationPhase,
  verifyAccountLayoutNavigation,
} from "./account-layout-navigation";
import {
  accountSectionLabels,
  accountSectionLandmarks,
} from "./account-sections";

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

const profileCopy = getAccountScreenCopy("en-US").profile;

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
    "div",
    null,
    createElement(
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
    ),
    createElement(
      "footer",
      { "data-testid": "public-site-footer" },
      createElement("a", { href: "/en-US/privacy-policy" }, "Privacy policy")
    )
  );
}

type FakeLocator = {
  readonly click: () => Promise<void>;
  readonly isVisible: () => Promise<boolean>;
  readonly waitFor: (options?: { readonly state?: string }) => Promise<void>;
};

type FakePageOptions = {
  readonly onSetViewport?: (viewport: {
    readonly height: number;
    readonly width: number;
  }) => void;
};

const desktopBreakpoint = 768;

const elementIsVisible = (element: Element): boolean => {
  for (
    let current: Element | null = element;
    current !== null;
    current = current.parentElement
  ) {
    if (current.hasAttribute("hidden")) return false;
    if (
      (current.classList.contains("md:hidden") &&
        window.innerWidth >= desktopBreakpoint) ||
      (current.classList.contains("hidden") &&
        window.innerWidth < desktopBreakpoint)
    )
      return false;
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
  waitFor: async (waitOptions = {}) => {
    if (waitOptions.state === "visible" && !elementIsVisible(element))
      throw new Error("fake target did not become visible");
  },
});

const makeFakePage = (options: FakePageOptions = {}): Page => {
  let viewport = { height: 900, width: 1024 };
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: viewport.width,
  });

  const getByRole = (
    role: "button",
    roleOptions: { readonly exact?: boolean; readonly name?: string } = {}
  ) => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>("button")
    );
    const name = roleOptions.name ?? "";
    const exact = roleOptions.exact !== false;
    const element = candidates.find((candidate) => {
      if (!elementIsVisible(candidate)) return false;
      const accessibleName =
        candidate.textContent?.replaceAll(/\s+/g, " ").trim() ?? "";
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
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length > 1) {
        throw new Error(
          `fake locator expected one match for ${selector}, got ${elements.length}`
        );
      }
      const element = elements[0];
      if (!element) throw new Error(`fake locator was not found: ${selector}`);
      return fakeLocator(element);
    },
    setViewportSize: async (nextViewport: {
      height: number;
      width: number;
    }) => {
      options.onSetViewport?.(nextViewport);
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

    const isResponsiveHidden = (element: Element): boolean => {
      for (
        let current: Element | null = element;
        current !== null;
        current = current.parentElement
      ) {
        if (
          (current.classList.contains("md:hidden") &&
            window.innerWidth >= desktopBreakpoint) ||
          (current.classList.contains("hidden") &&
            window.innerWidth < desktopBreakpoint)
        )
          return true;
      }
      return false;
    };

    if (isResponsiveHidden(this)) return makeRect(0, 0, 0, 0);

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

const accountLayoutFailureMarker =
  "https://private.example.test/account?email=secret@example.test&token=secret-token";
const accountLayoutFailure = new Error(accountLayoutFailureMarker, {
  cause: accountLayoutFailureMarker,
});
const diagnosticViewport = { height: 900, width: 375 } as const;

test("keeps every account layout phase diagnostic-safe", async () => {
  for (const phase of accountLayoutNavigationPhases) {
    const failure = await runAccountLayoutNavigationPhase(
      phase,
      "legal",
      diagnosticViewport,
      async () => {
        throw accountLayoutFailure;
      },
      phase === "geometry"
        ? async () => ({
            activeButtonCount: 1,
            contentLeft: 312,
            contentWidth: 1_100,
            hasHorizontalOverflow: false,
            navigationLeft: 16,
            navigationRight: 280,
            navigationWidth: 264,
            visibleLandmarkSelectors: [accountSectionLandmarks.legal],
          })
        : undefined
    ).then(
      () => {
        throw new Error("expected account layout phase to fail");
      },
      (cause) => cause
    );

    expect(failure).toBeInstanceOf(WorkspaceE2EError);
    if (!(failure instanceof WorkspaceE2EError))
      throw new Error("expected a Workspace E2E error");

    expect(failure.message).toContain(`at ${phase}`);
    expect(failure.message).toContain("for legal");
    expect(failure.message).toContain("at viewport 375x900");
    expect(failure.message).not.toContain(accountLayoutFailureMarker);
    expect(failure.operation).toBe("verify account layout navigation");
    expect(failure.cause).toBeUndefined();
    expect(failure.causes).toBeUndefined();
    expect(String(failure)).not.toContain(accountLayoutFailureMarker);
    expect(JSON.stringify(failure)).not.toContain(accountLayoutFailureMarker);
    expect(failure.message.length).toBeLessThan(500);

    if (phase === "geometry") {
      expect(failure.message).toContain("activeButtonCount=1");
      expect(failure.message).toContain(
        `visibleLandmarkSelectors=${accountSectionLandmarks.legal}`
      );
    }
  }
});

const runLayoutVerificationFailure = async (
  options: FakePageOptions,
  captureSection?: (section: AccountSection) => Promise<void>
) => {
  const restoreLayoutGeometry = installLayoutGeometry();
  try {
    render(createElement(AccountShellHarness));
    return await verifyAccountLayoutNavigation(
      makeFakePage(options),
      captureSection
    );
  } catch (cause) {
    return cause;
  } finally {
    restoreLayoutGeometry();
  }
};

const expectGenericAccountLayoutFailure = (
  failure: unknown,
  marker: string
) => {
  expect(failure).toBeInstanceOf(WorkspaceE2EError);
  if (!(failure instanceof WorkspaceE2EError))
    throw new Error("expected a Workspace E2E error");
  expect(failure.message).toBe("verify account layout navigation failed");
  expect(failure.operation).toBe("verify account layout navigation");
  expect(failure.cause).toBeUndefined();
  expect(failure.causes).toBeUndefined();
  expect(failure.message).not.toContain(marker);
  expect(failure.operation).not.toContain(marker);
  expect(String(failure)).not.toContain(marker);
  expect(JSON.stringify(failure)).not.toContain(marker);
};

test("uses a fixed generic diagnostic when changing the viewport fails", async () => {
  let setViewportCalls = 0;
  const failureMarker =
    "https://private.example.test/account/viewport?token=viewport-secret";
  const failure = await runLayoutVerificationFailure({
    onSetViewport: () => {
      setViewportCalls += 1;
      if (setViewportCalls === 1) throw new Error(failureMarker);
    },
  });

  expectGenericAccountLayoutFailure(failure, failureMarker);
  expect(setViewportCalls).toBe(2);
});

test("uses a fixed generic diagnostic when final viewport reset fails", async () => {
  let setViewportCalls = 0;
  const failureMarker =
    "https://private.example.test/account/reset?token=reset-secret";
  const failure = await runLayoutVerificationFailure({
    onSetViewport: () => {
      setViewportCalls += 1;
      if (setViewportCalls === 4) throw new Error(failureMarker);
    },
  });

  expectGenericAccountLayoutFailure(failure, failureMarker);
  expect(setViewportCalls).toBe(4);
});

test("preserves the phase diagnostic when final viewport reset also fails", async () => {
  let setViewportCalls = 0;
  const captureFailureMarker =
    "https://private.example.test/account/capture?email=secretA@example.test&token=secretA";
  const restoreFailureMarker =
    "https://private.example.test/account/restore?email=secretB@example.test&token=secretB";
  const failure = await runLayoutVerificationFailure(
    {
      onSetViewport: () => {
        setViewportCalls += 1;
        if (setViewportCalls === 2)
          throw new Error(restoreFailureMarker, {
            cause: restoreFailureMarker,
          });
      },
    },
    async () => {
      throw new Error(captureFailureMarker, { cause: captureFailureMarker });
    }
  );

  expect(failure).toBeInstanceOf(WorkspaceE2EError);
  if (!(failure instanceof WorkspaceE2EError))
    throw new Error("expected a Workspace E2E error");
  expect(failure.message).toContain("at capture");
  expect(failure.message).toContain("for reservations");
  expect(failure.message).toContain("at viewport 1440x1000");
  expect(failure.message).not.toContain(captureFailureMarker);
  expect(failure.message).not.toContain(restoreFailureMarker);
  expect(failure.operation).toBe("verify account layout navigation");
  expect(failure.cause).toBeUndefined();
  expect(failure.causes).toBeUndefined();
  expect(String(failure)).not.toContain(captureFailureMarker);
  expect(String(failure)).not.toContain(restoreFailureMarker);
  expect(JSON.stringify(failure)).not.toContain(captureFailureMarker);
  expect(JSON.stringify(failure)).not.toContain(restoreFailureMarker);
  expect(failure.message.length).toBeLessThan(500);
  expect(setViewportCalls).toBe(2);
});
