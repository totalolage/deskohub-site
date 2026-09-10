import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
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

  test("stacks the mobile header while restoring the desktop row", () => {
    const view = renderShell();
    const header = view.container.querySelector("header");
    if (!header) throw new Error("Account shell header was not rendered");
    const heading = view.getByRole("heading", { level: 1 });
    const signOut = view.getByRole("button", { name: "Sign out" });
    const signOutWrapper = signOut.parentElement;
    if (!signOutWrapper)
      throw new Error("Account shell sign-out wrapper was not rendered");

    expect(header.className).toContain("flex-col");
    expect(header.className).toContain("sm:flex-row");
    expect(header.className).toContain("sm:flex-wrap");
    expect(header.className).toContain("sm:items-start");
    expect(heading.className).toContain("w-full");
    expect(heading.className).toContain("sm:w-auto");
    expect(heading.className).toContain("min-w-0");
    expect(heading.className).toContain("flex-1");
    expect(signOutWrapper.className).toContain("self-start");
    expect(signOutWrapper.className).toContain("sm:self-auto");
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
});
