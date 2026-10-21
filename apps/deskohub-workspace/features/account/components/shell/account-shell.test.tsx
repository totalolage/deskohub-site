import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { AccountSection } from "@/features/account/sections";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AccountShell, type AccountShellProps } from "./account-shell";

const sectionKeys: readonly AccountSection[] = [
  "reservations",
  "referrals",
  "profile",
  "security",
  "assistants",
  "billing",
  "legal",
  "danger",
];

const labels: AccountShellProps["labels"] = {
  mobileSection: "Account section",
  navigation: "Account navigation",
  sections: {
    billing: "Billing & invoices",
    danger: "Danger zone",
    legal: "Legal & privacy",
    profile: "Profile & identity",
    referrals: "Referrals",
    reservations: "Reservations",
    security: "Sign-in & security",
    assistants: "Connected assistants",
  },
};

class TestResizeObserver implements ResizeObserver {
  static readonly instances: TestResizeObserver[] = [];

  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }

  disconnect() {}

  observe() {}

  unobserve() {}

  trigger() {
    this.callback([], this);
  }
}

const originalResizeObserver = globalThis.ResizeObserver;

function getLatestResizeObserver() {
  const observer = TestResizeObserver.instances.at(-1);
  if (!observer) throw new Error("ResizeObserver was not created");
  return observer;
}

function makeProps(
  overrides: Partial<AccountShellProps> = {}
): AccountShellProps {
  return {
    activeSection: "profile",
    children: <p>Account content</p>,
    labels,
    onSectionChange: () => undefined,
    sectionHref: (section) => `/en-US/account/${section}`,
    signOut: <button type="button">Sign out</button>,
    title: "Workspace account",
    ...overrides,
  };
}

function renderShell(overrides: Partial<AccountShellProps> = {}) {
  return render(<AccountShell {...makeProps(overrides)} />);
}

function getDesktopNavigation(view: { readonly container: HTMLElement }) {
  const desktopNavigation =
    view.container.querySelector<HTMLDivElement>("div.hidden");
  if (!desktopNavigation)
    throw new Error("Desktop account navigation was not rendered");
  return within(desktopNavigation);
}

function getDesktopLink(
  view: { readonly container: HTMLElement },
  section: AccountSection
) {
  return getDesktopNavigation(view).getByRole("link", {
    name: labels.sections[section],
  });
}

function getMobileNavigation(view: { readonly container: HTMLElement }) {
  return within(
    view.getByRole("group", {
      name: labels.mobileSection,
    })
  );
}

describe("AccountShell", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    globalThis.ResizeObserver = TestResizeObserver;
  });

  afterEach(() => {
    cleanup();
    TestResizeObserver.instances.length = 0;
  });

  afterAll(async () => {
    globalThis.ResizeObserver = originalResizeObserver;
    await unregisterWorkspaceComponentTestEnv();
  });

  test("links every desktop section to its path, dispatches plain clicks, and marks only the active section", () => {
    const onSectionChange = mock((section: AccountSection) => {
      void section;
    });
    const view = renderShell({
      activeSection: "legal",
      onSectionChange,
    });

    for (const section of sectionKeys) {
      const link = getDesktopLink(view, section);

      expect(link.getAttribute("href")).toBe(`/en-US/account/${section}`);
      expect(link.getAttribute("aria-current")).toBe(
        section === "legal" ? "page" : null
      );
      const plainClick = fireEvent.click(link);
      expect(plainClick).toBe(false);
    }

    expect(onSectionChange.mock.calls.map(([section]) => section)).toEqual(
      sectionKeys
    );
    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: labels.sections.legal })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  test("leaves modified clicks on a section link to the browser", () => {
    const onSectionChange = mock((section: AccountSection) => {
      void section;
    });
    const view = renderShell({ onSectionChange });
    const link = getDesktopLink(view, "billing");

    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      expect(fireEvent.click(link, init)).toBe(true);
    }

    expect(onSectionChange).not.toHaveBeenCalled();
  });

  test("disables anonymous nonlegal sections while keeping legal enabled", () => {
    const onSectionChange = mock((section: AccountSection) => {
      void section;
    });
    const disabledSections = sectionKeys.filter(
      (section) => section !== "legal"
    );
    const view = renderShell({
      activeSection: "legal",
      disabledSections,
      onSectionChange,
    });
    const mobileNavigation = getMobileNavigation(view);

    for (const section of disabledSections) {
      const mobileButton = mobileNavigation.getByRole("button", {
        name: labels.sections[section],
      }) as HTMLButtonElement;
      const desktopButton = getDesktopNavigation(view).getByRole("button", {
        name: labels.sections[section],
      }) as HTMLButtonElement;

      expect(mobileButton.disabled).toBe(true);
      expect(desktopButton.disabled).toBe(true);
      expect(mobileButton.hasAttribute("href")).toBe(false);
    }
    expect(
      mobileNavigation
        .getByRole("link", { name: labels.sections.legal })
        .getAttribute("href")
    ).toBe("/en-US/account/legal");

    fireEvent.click(
      mobileNavigation.getByRole("button", {
        name: labels.sections.profile,
      })
    );
    fireEvent.click(
      getDesktopNavigation(view).getByRole("button", {
        name: labels.sections.profile,
      })
    );
    fireEvent.click(
      mobileNavigation.getByRole("link", { name: labels.sections.legal })
    );
    fireEvent.click(getDesktopLink(view, "legal"));

    expect(onSectionChange.mock.calls.map(([section]) => section)).toEqual([
      "legal",
      "legal",
    ]);
  });

  test("corrects sticky focus targets obscured above or below the viewport", () => {
    const view = renderShell();
    const aside = view.container.querySelector("aside");
    if (!aside) throw new Error("Account shell aside was not rendered");
    const topTarget = getDesktopLink(view, "reservations");
    const bottomTarget = getDesktopLink(view, "billing");
    const topRect = mock(() => ({ bottom: 140, top: 80 }));
    const bottomRect = mock(() => ({
      bottom: window.innerHeight + 20,
      top: window.innerHeight - 20,
    }));
    const topScrollIntoView = mock(() => undefined);
    const bottomScrollIntoView = mock(() => undefined);
    Object.defineProperty(topTarget, "getBoundingClientRect", {
      configurable: true,
      value: topRect,
    });
    Object.defineProperty(topTarget, "scrollIntoView", {
      configurable: true,
      value: topScrollIntoView,
    });
    Object.defineProperty(bottomTarget, "getBoundingClientRect", {
      configurable: true,
      value: bottomRect,
    });
    Object.defineProperty(bottomTarget, "scrollIntoView", {
      configurable: true,
      value: bottomScrollIntoView,
    });
    const getComputedStyle = spyOn(window, "getComputedStyle").mockReturnValue({
      position: "sticky",
      top: "112px",
    } as CSSStyleDeclaration);

    try {
      fireEvent.focus(topTarget);
      fireEvent.focus(bottomTarget);

      expect(topRect).toHaveBeenCalledTimes(1);
      expect(topScrollIntoView).toHaveBeenCalledWith({
        block: "center",
        inline: "nearest",
      });
      expect(bottomRect).toHaveBeenCalledTimes(1);
      expect(bottomScrollIntoView).toHaveBeenCalledWith({
        block: "center",
        inline: "nearest",
      });
      expect(getComputedStyle).toHaveBeenCalledWith(aside);
    } finally {
      getComputedStyle.mockRestore();
    }
  });

  test("does not scroll an already visible sticky focus target", () => {
    const view = renderShell();
    const aside = view.container.querySelector("aside");
    if (!aside) throw new Error("Account shell aside was not rendered");
    const target = getDesktopLink(view, "reservations");
    const getBoundingClientRect = mock(() => ({ bottom: 160, top: 120 }));
    const scrollIntoView = mock(() => undefined);
    Object.defineProperty(target, "getBoundingClientRect", {
      configurable: true,
      value: getBoundingClientRect,
    });
    Object.defineProperty(target, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const getComputedStyle = spyOn(window, "getComputedStyle").mockReturnValue({
      position: "sticky",
      top: "112px",
    } as CSSStyleDeclaration);

    try {
      fireEvent.focus(target);

      expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      getComputedStyle.mockRestore();
    }
  });

  test("uses a controlled labelled mobile link group", () => {
    const onSectionChange = mock((section: AccountSection) => {
      void section;
    });
    const view = renderShell({
      activeSection: "reservations",
      onSectionChange,
    });
    const group = view.getByRole("group", {
      name: labels.mobileSection,
    });
    const navigation = view.getByRole("navigation", {
      name: labels.navigation,
    });
    const legend = group.querySelector("legend");
    if (!legend) throw new Error("Mobile account legend was not rendered");
    const mobileNavigation = group.querySelector<HTMLDivElement>(
      "[data-account-mobile-navigation]"
    );
    if (!mobileNavigation)
      throw new Error("Mobile account navigation was not rendered");
    const links = within(group).getAllByRole("link");

    expect(navigation.getAttribute("aria-label")).toBe(labels.navigation);
    expect(legend.textContent).toBe(labels.mobileSection);
    expect(navigation.querySelector("select")).toBeNull();
    expect(
      mobileNavigation.getAttribute("data-account-mobile-navigation")
    ).toBe("");
    expect(links).toHaveLength(sectionKeys.length);
    expect(
      links.map((link) => link.getAttribute("data-account-section"))
    ).toEqual(sectionKeys);
    expect(links.map((link) => link.textContent?.trim())).toEqual(
      sectionKeys.map((section) => labels.sections[section])
    );
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      sectionKeys.map((section) => `/en-US/account/${section}`)
    );
    expect(navigation.querySelector('[role="tablist"]')).toBeNull();
    expect(navigation.querySelector('[role="tab"]')).toBeNull();

    expect(
      within(group)
        .getByRole("link", { name: labels.sections.reservations })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(onSectionChange).not.toHaveBeenCalled();
    expect(
      within(group)
        .getByRole("link", { name: labels.sections.billing })
        .getAttribute("aria-current")
    ).toBeNull();

    fireEvent.click(
      within(group).getByRole("link", { name: labels.sections.billing })
    );

    expect(onSectionChange).toHaveBeenCalledWith("billing");
    expect(onSectionChange).toHaveBeenCalledTimes(1);
    expect(
      within(group)
        .getByRole("link", { name: labels.sections.reservations })
        .getAttribute("aria-current")
    ).toBe("page");

    view.rerender(
      <AccountShell
        {...makeProps({ activeSection: "billing", onSectionChange })}
      />
    );
    expect(onSectionChange).toHaveBeenCalledTimes(1);
    for (const section of sectionKeys) {
      expect(
        within(group)
          .getByRole("link", { name: labels.sections[section] })
          .getAttribute("aria-current")
      ).toBe(section === "billing" ? "page" : null);
    }

    onSectionChange.mockClear();
    for (const section of sectionKeys) {
      fireEvent.click(
        within(group).getByRole("link", {
          name: labels.sections[section],
        })
      );
    }
    expect(onSectionChange.mock.calls.map(([section]) => section)).toEqual(
      sectionKeys
    );
  });

  test("aligns the active mobile section start without stealing focus", () => {
    const originalGetBoundingClientRect =
      Element.prototype.getBoundingClientRect;
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const sectionPositions: Record<string, number> = {};
    const makeRect = (left: number, right: number): DOMRect =>
      ({
        bottom: 44,
        height: 44,
        left,
        right,
        top: 0,
        width: right - left,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    Element.prototype.getBoundingClientRect = function () {
      const section = this.getAttribute("data-account-section");
      if (section !== null && sectionPositions[section] !== undefined) {
        const mobileNavigation = this.closest(
          "[data-account-mobile-navigation]"
        );
        const scrollLeft =
          mobileNavigation instanceof HTMLElement
            ? mobileNavigation.scrollLeft
            : 0;
        const left = sectionPositions[section];
        return makeRect(left - scrollLeft, left + 100 - scrollLeft);
      }
      if (this.hasAttribute("data-account-mobile-navigation")) {
        return makeRect(0, 200);
      }
      return originalGetBoundingClientRect.call(this);
    };
    Element.prototype.scrollIntoView = mock(() => undefined);

    try {
      sectionPositions.billing = 240;
      sectionPositions.danger = 400;
      const view = renderShell({ activeSection: "billing" });
      const group = view.getByRole("group", { name: labels.mobileSection });
      const mobileNavigation = group.querySelector<HTMLDivElement>(
        "[data-account-mobile-navigation]"
      );
      if (!mobileNavigation)
        throw new Error("Mobile account navigation was not rendered");
      const billingButton = within(group).getByRole("link", {
        name: labels.sections.billing,
      });
      billingButton.focus();

      expect(mobileNavigation.scrollLeft).toBe(240);
      expect(document.activeElement).toBe(billingButton);

      view.rerender(
        <AccountShell {...makeProps({ activeSection: "danger" })} />
      );

      expect(mobileNavigation.scrollLeft).toBe(400);
      expect(document.activeElement).toBe(billingButton);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  test("aligns a right-clipped Czech-like section to its snap start", () => {
    const originalGetBoundingClientRect =
      Element.prototype.getBoundingClientRect;
    let isVisible = false;
    const activeButtonStart = 262;
    const activeButtonWidth = 173;
    const makeRect = (left: number, right: number): DOMRect =>
      ({
        bottom: 44,
        height: 44,
        left,
        right,
        top: 0,
        width: right - left,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    Element.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute("data-account-mobile-navigation")) {
        return makeRect(0, isVisible ? 320 : 0);
      }
      if (this.getAttribute("data-account-section") === "billing") {
        const mobileNavigation = this.closest(
          "[data-account-mobile-navigation]"
        );
        const scrollLeft =
          mobileNavigation instanceof HTMLElement
            ? mobileNavigation.scrollLeft
            : 0;
        return makeRect(
          activeButtonStart - scrollLeft,
          activeButtonStart + activeButtonWidth - scrollLeft
        );
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      const view = renderShell({ activeSection: "billing" });
      const group = view.getByRole("group", { name: labels.mobileSection });
      const mobileNavigation = group.querySelector<HTMLDivElement>(
        "[data-account-mobile-navigation]"
      );
      if (!mobileNavigation)
        throw new Error("Mobile account navigation was not rendered");
      const billingButton = within(group).getByRole("link", {
        name: labels.sections.billing,
      });
      const observer = getLatestResizeObserver();

      mobileNavigation.scrollLeft = 112;
      isVisible = true;
      expect(billingButton.getBoundingClientRect()).toMatchObject({
        left: 150,
        right: 323,
      });

      observer.trigger();

      expect(mobileNavigation.scrollLeft).toBe(262);
      expect(billingButton.getBoundingClientRect()).toMatchObject({
        left: 0,
        right: 173,
      });
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  test("aligns a left-clipped section and leaves a fully visible section unchanged", () => {
    const originalGetBoundingClientRect =
      Element.prototype.getBoundingClientRect;
    const activeButtonStart = 88;
    const activeButtonWidth = 173;
    const makeRect = (left: number, right: number): DOMRect =>
      ({
        bottom: 44,
        height: 44,
        left,
        right,
        top: 0,
        width: right - left,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    Element.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute("data-account-mobile-navigation")) {
        return makeRect(0, 320);
      }
      if (this.getAttribute("data-account-section") === "billing") {
        const mobileNavigation = this.closest(
          "[data-account-mobile-navigation]"
        );
        const scrollLeft =
          mobileNavigation instanceof HTMLElement
            ? mobileNavigation.scrollLeft
            : 0;
        return makeRect(
          activeButtonStart - scrollLeft,
          activeButtonStart + activeButtonWidth - scrollLeft
        );
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      const view = renderShell({ activeSection: "billing" });
      const group = view.getByRole("group", { name: labels.mobileSection });
      const mobileNavigation = group.querySelector<HTMLDivElement>(
        "[data-account-mobile-navigation]"
      );
      if (!mobileNavigation)
        throw new Error("Mobile account navigation was not rendered");
      const billingButton = within(group).getByRole("link", {
        name: labels.sections.billing,
      });
      const observer = getLatestResizeObserver();

      expect(mobileNavigation.scrollLeft).toBe(0);
      expect(billingButton.getBoundingClientRect()).toMatchObject({
        left: 88,
        right: 261,
      });

      mobileNavigation.scrollLeft = 112;
      expect(billingButton.getBoundingClientRect()).toMatchObject({
        left: -24,
        right: 149,
      });

      observer.trigger();

      expect(mobileNavigation.scrollLeft).toBe(88);
      expect(billingButton.getBoundingClientRect()).toMatchObject({
        left: 0,
        right: 173,
      });
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  test("renders only valid supplied reservation counts, including zero", () => {
    const view = renderShell();
    const reservationButton = () =>
      getDesktopNavigation(view).getByRole("link", {
        name: /^Reservations/,
      });

    expect(reservationButton().querySelector("span.ml-auto")).toBeNull();

    view.rerender(<AccountShell {...makeProps({ reservationCount: 0 })} />);
    expect(reservationButton().querySelector("span.ml-auto")?.textContent).toBe(
      "0"
    );

    for (const reservationCount of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      view.rerender(<AccountShell {...makeProps({ reservationCount })} />);
      expect(reservationButton().querySelector("span.ml-auto")).toBeNull();
    }
  });

  test("shows a supplied referral badge beside Referrals in the desktop navigation only", () => {
    const view = renderShell({
      referralBadge: { text: "-15%", label: "15% referral discount" },
    });
    const referralButton = () =>
      getDesktopNavigation(view).getByRole("link", { name: /^Referrals/ });

    expect(referralButton().querySelector("span.ml-auto")?.textContent).toBe(
      "-15%15% referral discount"
    );
    expect(
      getMobileNavigation(view).getByRole("link", { name: "Referrals" })
        .textContent
    ).toBe("Referrals");

    view.rerender(
      <AccountShell {...makeProps({ referralBadge: undefined })} />
    );
    expect(referralButton().querySelector("span.ml-auto")).toBeNull();
  });

  test("leaves hidden sections out of both navigations", () => {
    const view = renderShell({
      hiddenSections: ["referrals", "security"],
      referralBadge: { text: "-15%", label: "15% referral discount" },
    });

    expect(
      getDesktopNavigation(view).queryByRole("link", { name: /Referrals/ })
    ).toBeNull();
    expect(
      getMobileNavigation(view).queryByRole("link", { name: "Referrals" })
    ).toBeNull();
    expect(view.queryByText("-15%")).toBeNull();
    expect(
      getDesktopNavigation(view)
        .getAllByRole("link")
        .map((link) => link.getAttribute("data-account-sidebar-section"))
    ).toEqual([
      "reservations",
      "profile",
      "assistants",
      "billing",
      "legal",
      "danger",
    ]);
  });
});
