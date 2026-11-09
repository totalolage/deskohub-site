import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, useState } from "react";
import { AccountShell } from "@/features/account/components/shell/account-shell";
import { getAccountSectionPath } from "@/features/account/routes";
import type { AccountSection } from "@/features/account/sections";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  type AccountSectionPage,
  accountSectionLandmarks,
  selectAccountSection,
} from "./account-sections";

const sections = [
  "reservations",
  "referrals",
  "profile",
  "assistants",
  "billing",
  "legal",
  "danger",
] as const satisfies readonly AccountSection[];

const accountSectionDataAttribute = "data-account-section";

const sectionPanel = (section: AccountSection, includeLegalLink: boolean) => {
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
      return createElement(
        "section",
        { "data-screen": "profile-screen" },
        createElement("input", { id: "account-profile-first-name" })
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
  reservationCount,
}: {
  readonly includeLegalLink?: boolean;
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
        locale: "en-US",
        onSectionChange: setActiveSection,
        reservationCount,
        signOut: createElement("button", { type: "button" }, "Sign out"),
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
  readonly elementHandle: () => Promise<FakeElementHandle>;
  readonly isVisible: () => Promise<boolean>;
};

type FakeElementHandle = {
  readonly dispose: () => Promise<void>;
  readonly element: Element;
};

type FakePageOptions = {
  readonly onClick?: (options?: { readonly timeout?: number }) => void;
  readonly onIsVisible?: () => void;
  readonly onWait?: (argument: unknown) => void | Promise<void>;
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
  elementHandle: async () => ({
    dispose: async () => {},
    element,
  }),
  isVisible: async () => {
    options.onIsVisible?.();
    return elementIsVisible(element, width);
  },
});

const makeFakePage = (
  width: number | null,
  pageOptions: FakePageOptions = {}
): AccountSectionPage => {
  const page = Object.assign({} as AccountSectionPage, {
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
      const candidates: HTMLElement[] = [];
      if (role === "link") {
        candidates.push(...document.querySelectorAll<HTMLElement>("a"));
      }
      if (role === "button") {
        candidates.push(...document.querySelectorAll<HTMLElement>("button"));
      }
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
      const predicateArgument =
        typeof arg === "object" && arg !== null && "element" in arg
          ? (arg as FakeElementHandle).element
          : arg;
      await pageOptions.onWait?.(predicateArgument);
      const result = (pageFunction as (value: unknown) => unknown)(
        predicateArgument
      );
      if (!result) {
        throw new Error("fake account section did not settle");
      }
      return { dispose: async () => {}, jsonValue: async () => result };
    },
  });
  return page;
};

const setResponsiveNavigationVisibility = (
  mode: "desktop" | "mobile"
): void => {
  const navigation = document
    .querySelector("[data-account-mobile-navigation]")
    ?.closest("nav");
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

    const link = document.querySelector(
      `a[data-account-sidebar-section="${section}"]`
    );
    expect(link?.getAttribute("aria-current")).toBe("page");
    expect(link?.getAttribute("href")).toBe(
      getAccountSectionPath("en-US", section)
    );
  }
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
  render(createElement(AccountShellHarness, { reservationCount: 3 }));
  // The shell names its sections from the catalog, so the test renames the
  // rendered desktop link.
  const reservationsLabel = document.querySelector(
    '[data-account-sidebar-section="reservations"] .break-words'
  );
  if (reservationsLabel === null) {
    throw new Error("The desktop Reservations label is not rendered.");
  }
  reservationsLabel.textContent = "Reservations and billing";

  await expect(selectAccountSection(page, "reservations")).rejects.toThrow(
    "fake account section did not settle"
  );
});

test("selects every section through visible mobile section links", async () => {
  const page = makeFakePage(375);
  render(createElement(AccountShellHarness));

  for (const section of sections) {
    await selectAccountSection(page, section);

    const mobileNavigation = document.querySelector(
      "[data-account-mobile-navigation]"
    );
    const link = mobileNavigation?.querySelector<HTMLAnchorElement>(
      `[${accountSectionDataAttribute}="${section}"]`
    );
    expect(link?.getAttribute("aria-current")).toBe("page");
    expect(link?.getAttribute("href")).toBe(
      getAccountSectionPath("en-US", section)
    );
    expect(
      mobileNavigation?.querySelectorAll('a[aria-current="page"]')
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

      const activeLinks = document.querySelectorAll(
        mode === "mobile"
          ? '[data-account-mobile-navigation] a[aria-current="page"]'
          : 'a[data-account-sidebar-section][aria-current="page"]'
      );
      expect(activeLinks).toHaveLength(1);
      expect(
        activeLinks[0]?.getAttribute(
          mode === "mobile"
            ? "data-account-section"
            : "data-account-sidebar-section"
        )
      ).toBe(section);
      expect(
        document
          .querySelector(accountSectionLandmarks[section])
          ?.closest("[hidden]")
      ).toBeNull();
    }
  }
});

test("waits for the rendered section link handler before clicking it", async () => {
  const calls: string[] = [];
  let linkHandlerAttached = false;
  let restoreLinkHandler = () => {};
  const page = makeFakePage(1440, {
    onClick: () => {
      calls.push("click");
      if (!linkHandlerAttached) {
        throw new Error("account section link handler was not attached");
      }
    },
    onWait: async (argument) => {
      if (argument instanceof Element) {
        calls.push("wait:link-handler");
        await Promise.resolve();
        restoreLinkHandler();
        return;
      }
      if (typeof argument === "string") {
        calls.push(`wait:panel-hydration:${argument}`);
        return;
      }
      calls.push("wait:section-ready");
    },
  });
  render(createElement(AccountShellHarness));

  const billingLink = document.querySelector<HTMLAnchorElement>(
    'a[data-account-sidebar-section="billing"]'
  );
  if (billingLink === null)
    throw new Error("rendered Billing link was not found");
  const reactPropsKey = Object.keys(billingLink).find((key) =>
    key.startsWith("__reactProps$")
  );
  if (reactPropsKey === undefined)
    throw new Error("rendered Billing link has no React props");
  const reactPropsDescriptor = Object.getOwnPropertyDescriptor(
    billingLink,
    reactPropsKey
  );
  if (reactPropsDescriptor === undefined)
    throw new Error("rendered Billing link React props descriptor is missing");

  if (!Reflect.deleteProperty(billingLink, reactPropsKey))
    throw new Error("could not defer the rendered Billing link handler");
  restoreLinkHandler = () => {
    Object.defineProperty(billingLink, reactPropsKey, reactPropsDescriptor);
    linkHandlerAttached = true;
  };

  await selectAccountSection(page, "billing", (stage) =>
    calls.push(`stage:${stage}`)
  );

  expect(calls).toEqual([
    "stage:link-handler-wait",
    "wait:link-handler",
    "stage:panel-hydration-wait",
    "wait:panel-hydration:[data-screen='profile-screen']",
    "stage:native-link-click",
    "click",
    "stage:selected-landmark-wait",
    "wait:section-ready",
  ]);
  expect(billingLink.getAttribute("aria-current")).toBe("page");
});

test("does not click a section before its streamed panel is hydrated", async () => {
  const calls: string[] = [];
  const page = makeFakePage(1440, {
    onClick: () => {
      calls.push("click");
    },
  });
  render(createElement(AccountShellHarness));
  const profileScreen = document.querySelector(accountSectionLandmarks.profile);
  if (profileScreen === null)
    throw new Error("profile screen was not rendered");
  const serverCopy = profileScreen.cloneNode(true);
  profileScreen.replaceWith(serverCopy);

  await expect(
    selectAccountSection(page, "profile", (stage) => calls.push(stage))
  ).rejects.toThrow("fake account section did not settle");
  expect(calls).toEqual(["link-handler-wait", "panel-hydration-wait"]);
});
