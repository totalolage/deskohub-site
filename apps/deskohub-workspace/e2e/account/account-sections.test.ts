import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Effect } from "effect";
import { createElement, useState } from "react";
import {
  type AccountSection,
  AccountShell,
  type AccountShellProps,
} from "@/features/account/components/shell/account-shell";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  type AccountSectionPage,
  accountSectionLabels,
  accountSectionLandmarks,
  selectAccountSection,
  selectAccountSectionInRunner,
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

const misleadingShellLabels = {
  ...shellLabels,
  sections: {
    ...shellLabels.sections,
    reservations: "Reservations and billing",
  },
} as const satisfies AccountShellProps["labels"];

const sectionPanel = (section: AccountSection, includeLegalLink: boolean) => {
  switch (section) {
    case "reservations":
      return createElement(
        "h2",
        { id: "account-reservations-current-title" },
        "Current and upcoming"
      );
    case "profile":
      return createElement(
        "section",
        { "data-slot": "profile-screen" },
        createElement("input", { id: "account-profile-first-name" })
      );
    case "billing":
      return createElement(
        "section",
        { "aria-labelledby": "account-billing-title" },
        createElement("h2", { id: "account-billing-title" }, "Billing"),
        createElement("select", { id: "account-profile-billing-kind" })
      );
    case "legal":
      return includeLegalLink
        ? createElement(
            "a",
            { href: "/en-US/privacy-policy" },
            "Privacy policy"
          )
        : null;
    case "danger":
      return createElement(
        "button",
        { id: "delete-account-trigger", type: "button" },
        "Delete account"
      );
  }
};

function AccountShellHarness({
  includeLegalLink = true,
  labels = shellLabels,
  reservationCount,
}: {
  readonly includeLegalLink?: boolean;
  readonly labels?: AccountShellProps["labels"];
  readonly reservationCount?: number;
}) {
  const [activeSection, setActiveSection] =
    useState<AccountSection>("reservations");

  return createElement(
    "div",
    null,
    createElement(
      AccountShell,
      {
        activeSection,
        // The variadic children below are the rendered panels; this satisfies
        // AccountShellProps' required children field without replacing them.
        // biome-ignore lint/correctness/noChildrenProp: AccountShellProps requires children in its createElement props type.
        children: null,
        labels,
        onSectionChange: setActiveSection,
        reservationCount,
        signOut: createElement("button", { type: "button" }, "Sign out"),
        title: "Workspace account",
      },
      ...sections.map((section) =>
        createElement(
          "div",
          { hidden: activeSection !== section, key: section },
          sectionPanel(section, includeLegalLink)
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
  readonly click: (options?: { readonly timeout?: number }) => Promise<void>;
  readonly isVisible: () => Promise<boolean>;
};

type FakePageOptions = {
  readonly onClick?: (options?: { readonly timeout?: number }) => void;
  readonly onIsVisible?: () => void;
  readonly onWait?: () => void;
};

const desktopBreakpoint = 768;

const elementIsVisible = (element: Element, width: number | null): boolean => {
  for (
    let current: Element | null = element;
    current !== null;
    current = current.parentElement
  ) {
    if (current.hasAttribute("hidden")) return false;
    if (
      width !== null &&
      ((current.classList.contains("md:hidden") &&
        width >= desktopBreakpoint) ||
        (current.classList.contains("hidden") && width < desktopBreakpoint))
    )
      return false;
    const styles = window.getComputedStyle(current);
    if (styles.display === "none" || styles.visibility === "hidden") {
      return false;
    }
  }
  return true;
};

const fakeLocator = (
  element: Element,
  width: number | null,
  options: FakePageOptions
): FakeLocator => ({
  click: async (clickOptions) => {
    if (!elementIsVisible(element, width))
      throw new Error("fake target is hidden");
    options.onClick?.(clickOptions);
    fireEvent.click(element);
  },
  isVisible: async () => {
    options.onIsVisible?.();
    return elementIsVisible(element, width);
  },
});

const makeFakePage = (
  width: number | null,
  pageOptions: FakePageOptions = {}
): AccountSectionPage => {
  const page = {
    getByRole: (role: string, roleOptions?: unknown) => {
      const name =
        typeof roleOptions === "object" &&
        roleOptions !== null &&
        "name" in roleOptions
          ? String((roleOptions as { readonly name?: unknown }).name)
          : "";
      const exact =
        typeof roleOptions === "object" &&
        roleOptions !== null &&
        "exact" in roleOptions
          ? (roleOptions as { readonly exact?: unknown }).exact !== false
          : true;
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>("button")
      );
      const match = candidates.find((element) => {
        if (!elementIsVisible(element, width)) return false;
        const accessibleName =
          element.textContent?.replaceAll(/\s+/g, " ").trim() ?? "";
        return exact ? accessibleName === name : accessibleName.includes(name);
      });
      if (!match) throw new Error(`fake ${role} target was not found`);
      return fakeLocator(match, width, pageOptions);
    },
    viewportSize: () => (width === null ? null : { height: 900, width }),
    waitForFunction: async (pageFunction: unknown, arg: unknown) => {
      if (typeof pageFunction !== "function")
        throw new Error("fake wait predicate was not a function");
      pageOptions.onWait?.();
      if (!(pageFunction as (value: unknown) => boolean)(arg)) {
        throw new Error("fake account section did not settle");
      }
    },
  };
  return page;
};

const setResponsiveNavigationVisibility = (
  mode: "desktop" | "mobile"
): void => {
  const navigation = document.querySelector(
    'nav[aria-label="Account navigation"]'
  );
  if (!navigation) throw new Error("fake account navigation was not rendered");

  for (const child of Array.from(navigation.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.classList.contains("md:hidden")) {
      child.style.display = mode === "mobile" ? "block" : "none";
    }
    if (child.classList.contains("hidden")) {
      child.style.display = mode === "desktop" ? "block" : "none";
    }
  }
};

const makeRunner = (desktop: boolean) => {
  const calls: Array<{
    readonly args: readonly string[];
    readonly input: string | undefined;
  }> = [];
  const run: Runner = async (_command, args, options) => {
    calls.push({ args: args.slice(2), input: options?.input });
    return {
      exitCode: 0,
      stderr: "",
      stdout: args[2] === "eval" ? String(desktop) : "",
    };
  };
  return { calls, run };
};

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("selects every section through rendered desktop AccountShell controls", async () => {
  const page = makeFakePage(1440);
  render(createElement(AccountShellHarness));

  for (const section of sections) {
    await selectAccountSection(page, section);

    const landmark = document.querySelector(accountSectionLandmarks[section]);
    expect(landmark).toBeTruthy();
    expect(landmark?.closest("[hidden]")).toBeNull();

    const button = Array.from(
      document.querySelectorAll(
        'nav[aria-label="Account navigation"] button:not([data-account-section])'
      )
    ).find(
      (candidate) =>
        candidate.textContent?.replaceAll(/\s+/g, " ").trim() ===
        accountSectionLabels[section]
    );
    expect(button?.getAttribute("aria-current")).toBe("page");
  }
});

test("scopes the legal landmark to AccountShell when the public footer duplicates it", () => {
  render(createElement(AccountShellHarness));

  expect(document.querySelectorAll("a[href$='/privacy-policy']")).toHaveLength(
    2
  );
  const legalLandmarks = document.querySelectorAll(
    accountSectionLandmarks.legal
  );
  expect(legalLandmarks).toHaveLength(1);
  expect(legalLandmarks[0]?.closest("main")).not.toBeNull();
});

test("does not accept the public footer as the legal account landmark", async () => {
  const page = makeFakePage(1440);
  render(
    createElement(AccountShellHarness, {
      includeLegalLink: false,
    })
  );

  await expect(selectAccountSection(page, "legal")).rejects.toThrow(
    "fake account section did not settle"
  );
});

for (const reservationCount of [0, 3] as const) {
  test(`accepts the rendered Reservations label with count ${reservationCount}`, async () => {
    const page = makeFakePage(1440);
    render(
      createElement(AccountShellHarness, {
        reservationCount,
      })
    );

    await selectAccountSection(page, "reservations");

    expect(
      document.querySelector(accountSectionLandmarks.reservations)
    ).toBeTruthy();
  });
}

test("does not accept a misleading Reservations label prefix", async () => {
  const page = makeFakePage(1440);
  render(
    createElement(AccountShellHarness, {
      labels: misleadingShellLabels,
      reservationCount: 3,
    })
  );

  await expect(selectAccountSection(page, "reservations")).rejects.toThrow(
    "fake account section did not settle"
  );
});

test("selects every section through visible mobile section buttons", async () => {
  const page = makeFakePage(375);
  render(createElement(AccountShellHarness));

  for (const section of sections) {
    await selectAccountSection(page, section);

    const mobileNavigation = document.querySelector(
      "[data-account-mobile-navigation]"
    );
    const button = mobileNavigation?.querySelector<HTMLButtonElement>(
      `[data-account-section="${section}"]`
    );
    expect(button?.getAttribute("aria-current")).toBe("page");
    expect(
      mobileNavigation?.querySelectorAll('button[aria-current="page"]')
    ).toHaveLength(1);
    expect(
      document
        .querySelector(accountSectionLandmarks[section])
        ?.closest("[hidden]")
    ).toBeNull();
  }
});

test("resolves the responsive section variant when viewport size is unavailable", async () => {
  for (const mode of ["mobile", "desktop"] as const) {
    cleanup();
    const page = makeFakePage(null);
    render(createElement(AccountShellHarness));
    setResponsiveNavigationVisibility(mode);

    for (const section of sections) {
      await selectAccountSection(page, section);

      const activeButtons = document.querySelectorAll(
        mode === "mobile"
          ? '[data-account-mobile-navigation] button[aria-current="page"]'
          : 'nav[aria-label="Account navigation"] button:not([data-account-section])[aria-current="page"]'
      );
      expect(activeButtons).toHaveLength(1);
      expect(activeButtons[0]?.textContent?.trim()).toBe(
        accountSectionLabels[section]
      );
      expect(
        document
          .querySelector(accountSectionLandmarks[section])
          ?.closest("[hidden]")
      ).toBeNull();
    }
  }
});

test("lets the section click own delayed actionability before checking readiness", async () => {
  const calls: string[] = [];
  const page = makeFakePage(1440, {
    onClick: (options) => {
      calls.push(`click:${options?.timeout ?? "missing"}`);
    },
    onIsVisible: () => {
      throw new Error("selection must not probe button visibility");
    },
    onWait: () => {
      calls.push("wait");
    },
  });
  render(createElement(AccountShellHarness));

  await selectAccountSection(page, "billing");

  expect(calls).toEqual([
    `click:${workspaceE2ETimeouts.browserAction}`,
    "wait",
  ]);
});

test("uses a visible desktop button and waits for its visible landmark in the Runner adapter", async () => {
  const { calls, run } = makeRunner(true);

  await Effect.runPromise(
    selectAccountSectionInRunner(run, "account-sections-test", "billing")
  );

  expect(calls.map(({ args }) => args.slice(0, 2))).toEqual([
    ["eval", "--stdin"],
    [
      "click",
      'nav[aria-label="Account navigation"] button:not([data-account-section]):has-text("Billing & Invoices")',
    ],
    ["wait", "--fn"],
  ]);
  expect(calls[2]?.args[2]).toContain("#account-profile-billing-kind");
  expect(calls[2]?.args[2]).toContain('"desktop":true');
  expect(calls[2]?.args[2]).not.toContain(".click(");
});

test("uses the visible mobile section button in the Runner adapter", async () => {
  const { calls, run } = makeRunner(false);

  await Effect.runPromise(
    selectAccountSectionInRunner(run, "account-sections-test", "danger")
  );

  expect(calls.map(({ args }) => args.slice(0, 2))).toEqual([
    ["eval", "--stdin"],
    [
      "click",
      'nav[aria-label="Account navigation"] [data-account-mobile-navigation] button[data-account-section="danger"]',
    ],
    ["wait", "--fn"],
  ]);
  expect(calls[2]?.args[2]).toContain('"desktop":false');
  expect(calls[2]?.args[2]).toContain("#delete-account-trigger");
});
