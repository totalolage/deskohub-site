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
import type { ReactNode } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  type AccountSection,
  AccountShell,
  type AccountShellProps,
} from "./account-shell";

const sectionKeys: readonly AccountSection[] = [
  "reservations",
  "profile",
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
    reservations: "Reservations",
  },
};

class TestResizeObserver implements ResizeObserver {
  static readonly instances: TestResizeObserver[] = [];

  readonly callback: ResizeObserverCallback;
  observedElement: Element | null = null;
  disconnectCalls = 0;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }

  disconnect() {
    this.disconnectCalls += 1;
  }

  observe(target: Element) {
    this.observedElement = target;
  }

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

function getDesktopButton(
  view: { readonly container: HTMLElement },
  section: AccountSection
) {
  return getDesktopNavigation(view).getByRole("button", {
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

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders caller-owned title, content, and sign-out action", () => {
    const onSectionChange = mock((section: AccountSection) => {
      void section;
    });
    const onSignOut = mock(() => undefined);
    const view = renderShell({
      children: <div data-testid="account-content">Profile content</div>,
      onSectionChange,
      signOut: (
        <button onClick={onSignOut} type="button">
          Sign out
        </button>
      ),
      title: "Jan's Workspace Account",
    });

    expect(
      view.getByRole("heading", { level: 1, name: "Jan's Workspace Account" })
    ).toBeTruthy();
    expect(view.getByTestId("account-content")).toBeTruthy();

    fireEvent.click(getDesktopButton(view, "reservations"));
    fireEvent.click(view.getByRole("button", { name: "Sign out" }));

    expect(onSectionChange).toHaveBeenCalledWith("reservations");
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  test("dispatches every desktop section and marks only the active section", () => {
    const onSectionChange = mock((section: AccountSection) => {
      void section;
    });
    const view = renderShell({
      activeSection: "legal",
      onSectionChange,
    });

    for (const section of sectionKeys) {
      const button = getDesktopButton(view, section);

      expect(button.getAttribute("aria-current")).toBe(
        section === "legal" ? "page" : null
      );
      fireEvent.click(button);
    }

    expect(onSectionChange.mock.calls.map(([section]) => section)).toEqual(
      sectionKeys
    );
    expect(
      getDesktopNavigation(view)
        .getByRole("button", { name: labels.sections.legal })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(
      getDesktopNavigation(view).getByRole("button", {
        name: labels.sections.legal,
      }).className
    ).toContain("bg-[#00024f]");

    view.rerender(<AccountShell {...makeProps({ activeSection: "danger" })} />);
    const dangerButton = getDesktopButton(view, "danger");
    expect(dangerButton.className).toContain("bg-[#e71545]");
    expect(dangerButton.className).toContain("text-white");
    expect(dangerButton.className).toContain("hover:bg-[#e71545]");
    expect(dangerButton.className).not.toContain("bg-[#00024f]");
  });

  test("keeps every section enabled by default", () => {
    const view = renderShell();
    const mobileNavigation = getMobileNavigation(view);

    for (const section of sectionKeys) {
      const mobileButton = mobileNavigation.getByRole("button", {
        name: labels.sections[section],
      }) as HTMLButtonElement;
      const desktopButton = getDesktopButton(
        view,
        section
      ) as HTMLButtonElement;

      expect(mobileButton.disabled).toBe(false);
      expect(desktopButton.disabled).toBe(false);
    }
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

    for (const section of sectionKeys) {
      const mobileButton = mobileNavigation.getByRole("button", {
        name: labels.sections[section],
      }) as HTMLButtonElement;
      const desktopButton = getDesktopButton(
        view,
        section
      ) as HTMLButtonElement;
      const isLegal = section === "legal";

      expect(mobileButton.disabled).toBe(!isLegal);
      expect(desktopButton.disabled).toBe(!isLegal);
    }

    fireEvent.click(
      mobileNavigation.getByRole("button", {
        name: labels.sections.profile,
      })
    );
    fireEvent.click(getDesktopButton(view, "profile"));
    fireEvent.click(
      mobileNavigation.getByRole("button", { name: labels.sections.legal })
    );
    fireEvent.click(getDesktopButton(view, "legal"));

    expect(onSectionChange.mock.calls.map(([section]) => section)).toEqual([
      "legal",
      "legal",
    ]);
  });

  test("keeps the reference background, weight, and desktop geometry tokens explicit", () => {
    const view = renderShell();
    const main = view.container.querySelector("main");
    if (!main) throw new Error("Account shell main was not rendered");
    const content = main.querySelector(":scope > div");
    if (!content) throw new Error("Account shell content was not rendered");
    const grid = content.querySelector(":scope > div");
    if (!grid) throw new Error("Account shell grid was not rendered");

    expect(main.className).toContain(
      "[background:radial-gradient(circle_at_0%_0%,rgba(255,242,214,0.9),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(218,244,235,0.82),transparent_38%),#f8f5ef]"
    );
    expect(main.className).toContain("[--font-heading-weight:700]");
    expect(main.className).toContain("[--font-subheading-weight:600]");
    expect(main.className).toContain(
      "pt-[calc(var(--site-header-height)+3rem)]"
    );
    expect(main.className).toContain("lg:px-8");
    expect(content.className).toContain("max-w-[95rem]");
    expect(grid.className).toContain("mt-7");
    expect(grid.className).toContain("gap-8");
    expect(grid.className).toContain(
      "md:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)]"
    );

    const desktopRowGroup = Array.from(
      view.getByRole("navigation").querySelectorAll("div")
    ).find((element) => element.className.includes("gap-[6px]"));
    if (!desktopRowGroup)
      throw new Error("Desktop account rows were not rendered");
    expect(desktopRowGroup.className).toContain("gap-[6px]");
    const reservationButton = getDesktopButton(view, "reservations");
    expect(reservationButton.className).toContain("h-auto");
    expect(reservationButton.className).toContain("min-h-[40px]");
    expect(reservationButton.className).toContain("text-[15px]");
    const reservationIconClass =
      reservationButton.querySelector("svg")?.getAttribute("class") ?? "";
    expect(reservationIconClass).toContain("size-4");
  });

  test("bounds the desktop aside as a sticky scroll container", () => {
    const view = renderShell({
      sidebarFooter: <p>Need help at the reception desk.</p>,
    });
    const aside = view.container.querySelector("aside");
    if (!aside) throw new Error("Account shell aside was not rendered");

    expect(aside.className).toContain("md:sticky");
    expect(aside.className).toContain(
      "md:top-[calc(var(--site-header-height)+1rem)]"
    );
    expect(aside.className).toContain(
      "md:max-h-[calc(100dvh-var(--site-header-height)-2rem)]"
    );
    expect(aside.className).toContain("md:overflow-y-auto");
    expect(aside.className).not.toMatch(
      /(?<!md:)\b(?:sticky|overflow-y-auto)\b/
    );
  });

  test("corrects sticky focus targets obscured above or below the viewport", () => {
    const view = renderShell();
    const aside = view.container.querySelector("aside");
    if (!aside) throw new Error("Account shell aside was not rendered");
    const topTarget = getDesktopButton(view, "reservations");
    const bottomTarget = getDesktopButton(view, "billing");
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
    const target = getDesktopButton(view, "reservations");
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

  test("does not inspect or scroll a static mobile aside", () => {
    const view = renderShell();
    const aside = view.container.querySelector("aside");
    if (!aside) throw new Error("Account shell aside was not rendered");
    const target = getDesktopButton(view, "reservations");
    const getBoundingClientRect = mock(() => {
      throw new Error("Static mobile focus should not read target geometry");
    });
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
      position: "static",
      top: "auto",
    } as CSSStyleDeclaration);

    try {
      fireEvent.focus(target);

      expect(getComputedStyle).toHaveBeenCalledWith(aside);
      expect(getBoundingClientRect).not.toHaveBeenCalled();
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      getComputedStyle.mockRestore();
    }
  });

  test("keeps the mobile header in a constrained row and restores desktop wrapping", () => {
    const view = renderShell();
    const header = view.container.querySelector("header");
    if (!header) throw new Error("Account shell header was not rendered");
    const heading = view.getByRole("heading", { level: 1 });
    const signOut = view.getByRole("button", { name: "Sign out" });
    const signOutWrapper = signOut.parentElement;
    if (!signOutWrapper)
      throw new Error("Account shell sign-out wrapper was not rendered");
    const headingClassTokens = heading.className.split(/\s+/);
    const signOutWrapperClassTokens = signOutWrapper.className.split(/\s+/);

    expect(header.className).toContain("flex-row");
    expect(header.className).toContain("items-start");
    expect(header.className).toContain("justify-between");
    expect(header.className).toContain("gap-x-3");
    expect(header.className).toContain("sm:gap-x-8");
    expect(header.className).toContain("sm:flex-wrap");
    expect(header.className).not.toContain("flex-col");
    expect(headingClassTokens).toContain("min-w-min");
    expect(headingClassTokens).toContain("sm:min-w-0");
    expect(headingClassTokens).toContain("pr-px");
    expect(headingClassTokens).toContain("sm:pr-0");
    expect(headingClassTokens).not.toContain("min-w-0");
    expect(heading.className).toContain("flex-1");
    expect(heading.className).toContain("break-words");
    expect(heading.className).toContain("text-[24px]");
    expect(heading.className).toContain("min-[375px]:text-[28px]");
    expect(heading.className).toContain("sm:text-[36px]");
    expect(heading.className).not.toContain("w-full");
    expect(heading.className).not.toContain("sm:w-auto");
    expect(signOutWrapperClassTokens).toContain("min-w-0");
    expect(signOutWrapperClassTokens).toContain("max-w-[60%]");
    expect(signOutWrapperClassTokens).toContain("shrink");
    expect(signOutWrapperClassTokens).toContain("break-words");
    expect(signOutWrapperClassTokens).toContain("sm:max-w-full");
    expect(signOutWrapperClassTokens).toContain("sm:shrink-0");
    expect(signOutWrapperClassTokens).toContain("sm:break-normal");
    expect(signOutWrapperClassTokens).not.toContain("shrink-0");
    expect(signOutWrapperClassTokens).not.toContain("self-start");
    expect(signOutWrapperClassTokens).not.toContain("sm:self-auto");
  });

  test("allows the caller to omit the sign-out action", () => {
    const view = renderShell({ signOut: null });
    const header = view.container.querySelector("header");
    if (!header) throw new Error("Account shell header was not rendered");
    const heading = view.getByRole("heading", { level: 1 });

    expect(
      view.getByRole("heading", { level: 1, name: "Workspace account" })
    ).toBeTruthy();
    expect(header.children).toHaveLength(1);
    expect(header.firstElementChild).toBe(heading);
    expect(view.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  test("preserves caller-owned pending and feedback content in the action slot", () => {
    const view = renderShell({
      signOut: (
        <>
          <span data-testid="sign-out-pending">Signing out...</span>
          <span data-testid="sign-out-feedback">Try again.</span>
        </>
      ),
    });

    expect(view.getByTestId("sign-out-pending").textContent).toBe(
      "Signing out..."
    );
    expect(view.getByTestId("sign-out-feedback").textContent).toBe(
      "Try again."
    );
  });

  test("uses a controlled labelled mobile button group", () => {
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
    const mobileNavigation = group.querySelector<HTMLDivElement>(
      "[data-account-mobile-navigation]"
    );
    if (!mobileNavigation)
      throw new Error("Mobile account navigation was not rendered");
    const buttons = within(group).getAllByRole("button");

    expect(view.getByRole("navigation").querySelector("select")).toBeNull();
    expect(
      mobileNavigation.getAttribute("data-account-mobile-navigation")
    ).toBe("");
    expect(mobileNavigation.className).toContain("min-w-0");
    expect(mobileNavigation.className).toContain("flex");
    expect(mobileNavigation.className).toContain("flex-nowrap");
    expect(mobileNavigation.className).toContain("overflow-x-auto");
    expect(mobileNavigation.className).toContain("touch-pan-x");
    expect(mobileNavigation.className).toContain("px-1");
    expect(mobileNavigation.className).toContain("py-1");
    expect(buttons).toHaveLength(sectionKeys.length);
    expect(
      buttons.map((button) => button.getAttribute("data-account-section"))
    ).toEqual(sectionKeys);
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(
      sectionKeys.map((section) => labels.sections[section])
    );
    for (const button of buttons) {
      expect(button.getAttribute("type")).toBe("button");
      expect(button.className).toContain("min-h-[44px]");
      expect(button.className).toContain("shrink-0");
      expect(button.className).toContain("whitespace-nowrap");
      expect(button.className).toContain("focus-visible:ring-inset");
      expect(button.className).toContain("focus-visible:ring-offset-0");
    }
    expect(group.querySelector('[role="tablist"]')).toBeNull();
    expect(group.querySelector('[role="tab"]')).toBeNull();

    expect(
      within(group)
        .getByRole("button", { name: labels.sections.reservations })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(onSectionChange).not.toHaveBeenCalled();
    expect(
      within(group)
        .getByRole("button", { name: labels.sections.billing })
        .getAttribute("aria-current")
    ).toBeNull();

    fireEvent.click(
      within(group).getByRole("button", { name: labels.sections.billing })
    );

    expect(onSectionChange).toHaveBeenCalledWith("billing");
    expect(onSectionChange).toHaveBeenCalledTimes(1);
    expect(
      within(group)
        .getByRole("button", { name: labels.sections.reservations })
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
          .getByRole("button", { name: labels.sections[section] })
          .getAttribute("aria-current")
      ).toBe(section === "billing" ? "page" : null);
    }
    expect(
      within(group).getByRole("button", { name: labels.sections.billing })
        .className
    ).toContain("bg-[#00024f]");
    expect(
      within(group).getByRole("button", { name: labels.sections.danger })
        .className
    ).toContain("text-[#d71945]");

    onSectionChange.mockClear();
    for (const section of sectionKeys) {
      fireEvent.click(
        within(group).getByRole("button", {
          name: labels.sections[section],
        })
      );
    }
    expect(onSectionChange.mock.calls.map(([section]) => section)).toEqual(
      sectionKeys
    );
  });

  test("scrolls the active mobile section locally without stealing focus", () => {
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
      const billingButton = within(group).getByRole("button", {
        name: labels.sections.billing,
      });
      billingButton.focus();

      expect(mobileNavigation.scrollLeft).toBe(140);
      expect(document.activeElement).toBe(billingButton);

      view.rerender(
        <AccountShell {...makeProps({ activeSection: "danger" })} />
      );

      expect(mobileNavigation.scrollLeft).toBe(300);
      expect(document.activeElement).toBe(billingButton);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  test("re-reveals the active mobile section when hidden layout becomes visible", () => {
    const originalGetBoundingClientRect =
      Element.prototype.getBoundingClientRect;
    let isVisible = false;
    const sectionPosition = 400;
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
        return makeRect(0, isVisible ? 200 : 0);
      }
      if (this.getAttribute("data-account-section") === "danger") {
        const mobileNavigation = this.closest(
          "[data-account-mobile-navigation]"
        );
        const scrollLeft =
          mobileNavigation instanceof HTMLElement
            ? mobileNavigation.scrollLeft
            : 0;
        return makeRect(
          sectionPosition - scrollLeft,
          sectionPosition + 100 - scrollLeft
        );
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      const view = renderShell({ activeSection: "danger" });
      const group = view.getByRole("group", { name: labels.mobileSection });
      const mobileNavigation = group.querySelector<HTMLDivElement>(
        "[data-account-mobile-navigation]"
      );
      if (!mobileNavigation)
        throw new Error("Mobile account navigation was not rendered");
      const observer = getLatestResizeObserver();

      expect(observer.observedElement).toBe(mobileNavigation);
      expect(mobileNavigation.scrollLeft).toBe(0);

      isVisible = true;
      observer.trigger();

      expect(mobileNavigation.scrollLeft).toBe(300);
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  test("re-reveals the active mobile section when its container narrows", () => {
    const originalGetBoundingClientRect =
      Element.prototype.getBoundingClientRect;
    let navigationWidth = 500;
    const sectionPosition = 400;
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
        return makeRect(0, navigationWidth);
      }
      if (this.getAttribute("data-account-section") === "danger") {
        const mobileNavigation = this.closest(
          "[data-account-mobile-navigation]"
        );
        const scrollLeft =
          mobileNavigation instanceof HTMLElement
            ? mobileNavigation.scrollLeft
            : 0;
        return makeRect(
          sectionPosition - scrollLeft,
          sectionPosition + 100 - scrollLeft
        );
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      const view = renderShell({ activeSection: "danger" });
      const group = view.getByRole("group", { name: labels.mobileSection });
      const mobileNavigation = group.querySelector<HTMLDivElement>(
        "[data-account-mobile-navigation]"
      );
      if (!mobileNavigation)
        throw new Error("Mobile account navigation was not rendered");
      const observer = getLatestResizeObserver();

      expect(mobileNavigation.scrollLeft).toBe(0);

      navigationWidth = 200;
      observer.trigger();

      expect(mobileNavigation.scrollLeft).toBe(300);
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  test("disconnects the mobile ResizeObserver when unmounted", () => {
    const view = renderShell({ activeSection: "danger" });
    const observer = getLatestResizeObserver();

    view.unmount();

    expect(observer.disconnectCalls).toBe(1);
  });

  test("renders only valid supplied reservation counts, including zero", () => {
    const view = renderShell();
    const reservationButton = () =>
      getDesktopNavigation(view).getByRole("button", {
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

  test("keeps the reservation count badge text paint local across active sections", () => {
    const view = renderShell({
      activeSection: "profile",
      reservationCount: 0,
    });

    for (const activeSection of ["profile", "reservations"] as const) {
      view.rerender(
        <AccountShell
          {...makeProps({
            activeSection,
            reservationCount: activeSection === "profile" ? 0 : 3,
          })}
        />
      );

      const badge = getDesktopNavigation(view)
        .getByRole("button", { name: /^Reservations/ })
        .querySelector("span.ml-auto");
      if (!badge) throw new Error("Reservation count badge was not rendered");

      expect(badge.className).toContain("bg-[#b06147]");
      expect(badge.className).toContain("text-white");
      expect(badge.className).toContain(
        "[font-family:var(--font-sculpin,Arial),sans-serif]"
      );
      expect(badge.className).not.toContain("bg-[#cf7253]");
      expect(badge.className).not.toContain("text-[#00024f]");
    }
  });

  test("retains long localized title and section labels", () => {
    const localizedLabels: AccountShellProps["labels"] = {
      mobileSection: "Vyberte sekci svého zákaznického účtu",
      navigation: "Navigace zákaznického účtu",
      sections: {
        billing: "Fakturace a účetní doklady",
        danger: "Nebezpečná zóna účtu",
        legal: "Právo, soukromí a souhlasy",
        profile: "Profil a identita zákazníka",
        reservations: "Rezervace a nadcházející návštěvy",
      },
    };
    const title = "Nastavení zákaznického účtu pro vaše Workspace rezervace";
    const view = renderShell({ labels: localizedLabels, title });

    expect(view.getByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(
      getDesktopNavigation(view).getByRole("button", {
        name: localizedLabels.sections.legal,
      })
    ).toBeTruthy();
    expect(
      within(
        view.getByRole("group", { name: localizedLabels.mobileSection })
      ).getByRole("button", {
        name: localizedLabels.sections.reservations,
      })
    ).toBeTruthy();
  });

  test("renders the caller-owned sidebar footer below navigation", () => {
    const footer: ReactNode = (
      <p data-testid="sidebar-footer">Need help at the reception desk.</p>
    );
    const view = renderShell({ sidebarFooter: footer });

    expect(view.getByTestId("sidebar-footer").textContent).toBe(
      "Need help at the reception desk."
    );
  });

  test("accepts a null sign-out action", () => {
    const view = renderShell({ signOut: null });

    expect(view.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});
