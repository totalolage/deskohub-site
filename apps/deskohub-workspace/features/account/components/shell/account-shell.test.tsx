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
import { cleanup, fireEvent, render } from "@testing-library/react";
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

describe("AccountShell", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
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

    fireEvent.click(view.getByRole("button", { name: "Reservations" }));
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
      const button = view.getByRole("button", {
        name: labels.sections[section],
      });

      expect(button.getAttribute("aria-current")).toBe(
        section === "legal" ? "page" : null
      );
      fireEvent.click(button);
    }

    expect(onSectionChange.mock.calls.map(([section]) => section)).toEqual(
      sectionKeys
    );
    expect(
      view
        .getByRole("button", { name: labels.sections.legal })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(
      view.getByRole("button", { name: labels.sections.legal }).className
    ).toContain("bg-[#00024f]");

    view.rerender(<AccountShell {...makeProps({ activeSection: "danger" })} />);
    const dangerButton = view.getByRole("button", {
      name: labels.sections.danger,
    });
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
    const reservationButton = view.getByRole("button", {
      name: labels.sections.reservations,
    });
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
    const topTarget = view.getByRole("button", { name: "Reservations" });
    const bottomTarget = view.getByRole("button", {
      name: "Billing & invoices",
    });
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
    const target = view.getByRole("button", { name: "Reservations" });
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
    const target = view.getByRole("button", { name: "Reservations" });
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

  test("uses a controlled native mobile select", () => {
    const onSectionChange = mock((section: AccountSection) => {
      void section;
    });
    const view = renderShell({
      activeSection: "reservations",
      onSectionChange,
    });
    const select = view.getByRole("combobox", {
      name: labels.mobileSection,
    }) as HTMLSelectElement;

    expect(select.value).toBe("reservations");
    fireEvent.change(select, { target: { value: "billing" } });

    expect(onSectionChange).toHaveBeenCalledWith("billing");
    expect(select.value).toBe("reservations");

    view.rerender(
      <AccountShell
        {...makeProps({ activeSection: "billing", onSectionChange })}
      />
    );
    expect(select.value).toBe("billing");
  });

  test("renders only valid supplied reservation counts, including zero", () => {
    const view = renderShell();
    const reservationButton = () =>
      view.getByRole("button", { name: /^Reservations/ });

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
      view.getByRole("button", {
        name: localizedLabels.sections.legal,
      })
    ).toBeTruthy();
    expect(
      view.getByRole("option", {
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
