import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { Page } from "@playwright/test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, useState } from "react";
import { AccountShell } from "@/features/account/components/shell/account-shell";
import {
  type AccountSection,
  accountSectionLabel,
} from "@/features/account/sections";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { isWorkspaceE2EDiagnosticCode, WorkspaceE2EError } from "../errors";
import {
  accountLayoutNavigationPhases,
  runAccountLayoutNavigationPhase,
  verifyAccountLayoutNavigation,
} from "./account-layout-navigation";

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

mock.module("@/features/account/actions", () => ({
  updateLocalePreference: () => Promise.resolve({ data: { status: "saved" } }),
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: () => ({
    execute: () => undefined,
    isExecuting: false,
    reset: () => undefined,
    result: {},
  }),
}));

const { ProfileScreen } = await import(
  "@/features/account/components/profile/profile-screen"
);

const sections = [
  "profile",
  "reservations",
  "referrals",
  "security",
  "assistants",
  "billing",
  "legal",
  "danger",
] as const satisfies readonly AccountSection[];

const sectionPanel = (section: AccountSection) => {
  switch (section) {
    case "reservations":
      return createElement(
        "h2",
        { id: "account-reservations-past-title" },
        "Past reservations"
      );
    case "referrals":
      return createElement(
        "section",
        { "data-screen": "referrals-screen" },
        createElement("h2", null, "Referrals")
      );
    case "profile":
      return createElement(ProfileScreen, {
        // ProfileScreen's typed createElement overload requires children in props.
        // biome-ignore lint/correctness/noChildrenProp: the required child must be present in the props object.
        children: createElement("input", { id: "account-profile-first-name" }),
        email: testEmailAddress("synthetic"),
        firstName: "E2E",
        lastName: null,
        locale: "en-US",
      });
    case "security":
      return createElement(
        "h2",
        { id: "account-security-passkeys-title" },
        "Passkeys"
      );
    case "assistants":
      return createElement(
        "h2",
        { id: "account-assistants-title" },
        "Connected assistants"
      );
    case "billing":
      return createElement(
        "section",
        { "aria-labelledby": "account-billing-title" },
        createElement(
          "h2",
          { id: "account-billing-title" },
          accountSectionLabel("billing", "en-US")
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

let selectedSections: AccountSection[] = [];

function AccountShellHarness({
  hiddenSections = [],
}: {
  readonly hiddenSections?: readonly AccountSection[];
} = {}) {
  const [activeSection, setActiveSection] =
    useState<AccountSection>("reservations");
  const selectSection = (section: AccountSection) => {
    selectedSections = [...selectedSections, section];
    setActiveSection(section);
  };

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
        hiddenSections,
        locale: "en-US",
        onSectionChange: selectSection,
        signOut: createElement("button", { type: "button" }, "Sign out"),
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
  readonly elementHandle: () => Promise<FakeElementHandle>;
  readonly isVisible: () => Promise<boolean>;
  readonly waitFor: (options?: { readonly state?: string }) => Promise<void>;
};

type FakeElementHandle = {
  readonly dispose: () => Promise<void>;
  readonly element: Element;
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
  elementHandle: async () => ({
    dispose: async () => {},
    element,
  }),
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
    role: "link",
    roleOptions: { readonly exact?: boolean; readonly name?: string } = {}
  ) => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a")
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
      const predicateArgument =
        typeof arg === "object" && arg !== null && "element" in arg
          ? arg.element
          : arg;
      const result = (pageFunction as (value: unknown) => unknown)(
        predicateArgument
      );
      if (!result) throw new Error("fake account section did not settle");
      return { dispose: async () => {}, jsonValue: async () => result };
    },
  });

  return page;
};

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(() => {
  cleanup();
  selectedSections = [];
});
afterAll(unregisterWorkspaceComponentTestEnv);

const reservationsPanelIsVisible = () => {
  const landmark = document.querySelector("#account-reservations-past-title");
  return landmark !== null && elementIsVisible(landmark);
};

test("switches one section per layout and restores the viewport", async () => {
  const viewports: { readonly height: number; readonly width: number }[] = [];
  let capturedSections: readonly AccountSection[] = [];
  render(createElement(AccountShellHarness));

  await verifyAccountLayoutNavigation(
    makeFakePage({ onSetViewport: (viewport) => viewports.push(viewport) }),
    async (section) => {
      capturedSections = [...capturedSections, section];
    },
    { screenshots: false }
  );

  expect(selectedSections).toEqual(["profile", "reservations"]);
  expect(capturedSections).toEqual([]);
  expect(viewports).toEqual([
    { height: 1000, width: 1440 },
    { height: 900, width: 375 },
    { height: 900, width: 1024 },
  ]);
  expect(reservationsPanelIsVisible()).toBe(true);
});

test("visits and captures every desktop section in review runs", async () => {
  let capturedSections: readonly AccountSection[] = [];
  render(createElement(AccountShellHarness));

  await verifyAccountLayoutNavigation(
    makeFakePage(),
    async (section) => {
      capturedSections = [...capturedSections, section];
    },
    { screenshots: true }
  );

  expect(capturedSections).toEqual(sections);
  expect(selectedSections).toEqual([...sections, "reservations"]);
  expect(reservationsPanelIsVisible()).toBe(true);
});

test("skips a flag-hidden section in review runs", async () => {
  let capturedSections: readonly AccountSection[] = [];
  render(createElement(AccountShellHarness, { hiddenSections: ["security"] }));

  await verifyAccountLayoutNavigation(
    makeFakePage(),
    async (section) => {
      capturedSections = [...capturedSections, section];
    },
    { screenshots: true }
  );

  const offered = sections.filter((section) => section !== "security");
  expect(capturedSections).toEqual(offered);
  expect(selectedSections).toEqual([...offered, "reservations"]);
});

const accountLayoutFailureMarker = `https://private.example.test/account?email=${testEmailAddress("secret")}&token=secret-token`;
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
      }
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
  }
});

test("codes every account navigation phase and section with a closed diagnostic", async () => {
  const diagnosticCodes = new Set<string>();

  for (const phase of accountLayoutNavigationPhases) {
    for (const section of sections) {
      const failure = await runAccountLayoutNavigationPhase(
        phase,
        section,
        diagnosticViewport,
        async () => {
          throw new Error(accountLayoutFailureMarker);
        }
      ).then(
        () => {
          throw new Error("expected account layout phase to fail");
        },
        (cause) => cause
      );

      expect(failure).toBeInstanceOf(WorkspaceE2EError);
      if (!(failure instanceof WorkspaceE2EError))
        throw new Error("expected a Workspace E2E error");

      const expectedCode = `account_layout_${phase}_${section}_failed`;
      expect(failure.diagnosticCode).toBe(expectedCode);
      expect(isWorkspaceE2EDiagnosticCode(failure.diagnosticCode)).toBe(true);
      expect(failure.diagnosticCode).not.toContain(accountLayoutFailureMarker);
      diagnosticCodes.add(failure.diagnosticCode ?? "");
    }
  }

  expect(diagnosticCodes.size).toBe(
    accountLayoutNavigationPhases.length * sections.length
  );
});

const runLayoutVerificationFailure = async (
  options: FakePageOptions,
  captureSection?: (section: AccountSection) => Promise<void>
) => {
  try {
    render(createElement(AccountShellHarness));
    return await verifyAccountLayoutNavigation(
      makeFakePage(options),
      captureSection,
      { screenshots: captureSection !== undefined }
    );
  } catch (cause) {
    return cause;
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
      if (setViewportCalls === 3) throw new Error(failureMarker);
    },
  });

  expectGenericAccountLayoutFailure(failure, failureMarker);
  expect(setViewportCalls).toBe(3);
});

test("preserves the phase diagnostic when final viewport reset also fails", async () => {
  let setViewportCalls = 0;
  const captureFailureMarker = `https://private.example.test/account/capture?email=${testEmailAddress("secretA")}&token=secretA`;
  const restoreFailureMarker = `https://private.example.test/account/restore?email=${testEmailAddress("secretB")}&token=secretB`;
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
  expect(failure.message).toContain("for profile");
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
