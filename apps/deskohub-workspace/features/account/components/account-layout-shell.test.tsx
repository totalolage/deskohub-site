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
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/shared/components/unsaved-changes-guard";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

let pathname = "/en-US/account";
const routerPush = mock((_href: string) => undefined);
const routerRefresh = mock(() => undefined);
const routerReplace = mock((_href: string) => undefined);

mock.module("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
    replace: routerReplace,
  }),
  unstable_rethrow: (cause: unknown) => {
    throw cause;
  },
}));

mock.module("@/features/account/components/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

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
const { AccountLayoutShell, useAccountLayout } = await import(
  "./account-layout-shell"
);

function layoutElement(
  children: ReactNode,
  options: {
    readonly passkeysEnabled?: boolean;
    readonly referralsEnabled?: boolean;
    readonly signedIn?: boolean;
  } = {}
) {
  return (
    <AccountLayoutShell
      locale="en-US"
      passkeysEnabled={options.passkeysEnabled ?? false}
      referralsEnabled={options.referralsEnabled ?? true}
      signedIn={options.signedIn ?? true}
    >
      {children}
    </AccountLayoutShell>
  );
}

function renderLayout(
  children: ReactNode,
  options: {
    readonly passkeysEnabled?: boolean;
    readonly referralsEnabled?: boolean;
    readonly signedIn?: boolean;
  } = {}
) {
  return render(layoutElement(children, options));
}

function getDesktopNavigation(view: { readonly container: HTMLElement }) {
  const navigation = view.container.querySelector<HTMLDivElement>("div.hidden");
  if (!navigation)
    throw new Error("Desktop account navigation was not rendered");
  return within(navigation);
}

function getMobileNavigation(view: { readonly container: HTMLElement }) {
  return within(
    view.getByRole("group", {
      name: "Account section",
    })
  );
}

function DirtyContent() {
  useUnsavedChanges({
    enabled: true,
    isDirty: () => true,
    message: "Discard these changes?",
  });

  return <p>Unsaved account changes</p>;
}

function ReferralBadgePublisher({
  section,
}: {
  readonly section?: "referrals";
}) {
  const { changeSection, setReferralBadge } = useAccountLayout();
  return (
    <>
      <button
        onClick={() =>
          setReferralBadge({ text: "-15%", label: "15% referral discount" })
        }
        type="button"
      >
        Publish badge
      </button>
      {section && (
        <button onClick={() => changeSection(section)} type="button">
          Open {section}
        </button>
      )}
    </>
  );
}

describe("AccountLayoutShell", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    globalThis.ResizeObserver = TestResizeObserver;
  });

  afterEach(() => {
    cleanup();
    pathname = "/en-US/account";
    routerPush.mockClear();
    routerRefresh.mockClear();
    routerReplace.mockClear();
  });

  afterAll(async () => {
    globalThis.ResizeObserver = originalResizeObserver;
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders content and disables private sections when signed out", () => {
    pathname = "/en-US/account/legal";
    const view = renderLayout(
      <>
        <p data-testid="account-content">Public legal</p>
        <p data-testid="account-modal">Account modal</p>
      </>,
      { signedIn: false }
    );
    const sectionKeys = [
      "Reservations",
      "Profile & Identity",
      "Billing & Invoices",
      "Danger zone",
    ];

    for (const label of sectionKeys) {
      expect(
        (
          getDesktopNavigation(view).getByRole("button", {
            name: label,
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
      expect(
        (
          getMobileNavigation(view).getByRole("button", {
            name: label,
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
    }

    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: "Legal & Privacy" })
        .getAttribute("href")
    ).toBe("/en-US/account/legal");
    expect(view.getByTestId("account-content")).toBeTruthy();
    expect(view.getByTestId("account-modal")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  test("cancels legal navigation when the existing dirty guard rejects it", () => {
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <AccountLayoutShell locale="en-US" referralsEnabled signedIn>
            <DirtyContent />
          </AccountLayoutShell>
        </UnsavedChangesProvider>
      );

      fireEvent.click(
        getDesktopNavigation(view).getByRole("link", {
          name: "Legal & Privacy",
        })
      );

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(routerPush).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("routes between legal and local sections through the account URLs", () => {
    const view = renderLayout(<p>Account</p>);

    fireEvent.click(
      getDesktopNavigation(view).getByRole("link", {
        name: "Legal & Privacy",
      })
    );
    expect(routerPush).toHaveBeenCalledWith("/en-US/account/legal");

    pathname = "/en-US/account/legal";
    view.rerender(layoutElement(<p>Legal</p>));
    fireEvent.click(
      getDesktopNavigation(view).getByRole("link", {
        name: "Profile & Identity",
      })
    );

    expect(routerPush).toHaveBeenCalledWith("/en-US/account/profile");
  });

  test("updates active sections from pathname changes", () => {
    pathname = "/en-US/account/profile";
    const view = renderLayout(<p>Account</p>);

    fireEvent.click(
      getDesktopNavigation(view).getByRole("link", {
        name: "Billing & Invoices",
      })
    );
    expect(routerPush).not.toHaveBeenCalled();
    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: "Billing & Invoices" })
        .getAttribute("aria-current")
    ).toBe("page");

    pathname = "/en-US/account/danger";
    view.rerender(layoutElement(<p>Account from browser back</p>));
    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: "Danger zone" })
        .getAttribute("aria-current")
    ).toBe("page");

    pathname = "/en-US/account/legal";
    view.rerender(layoutElement(<p>Legal from browser back</p>));
    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: "Legal & Privacy" })
        .getAttribute("aria-current")
    ).toBe("page");

    pathname = "/en-US/account/profile/";
    view.rerender(layoutElement(<p>Profile from browser back</p>));
    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: "Profile & Identity" })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  test("records a local section switch in the URL so a locale switch keeps it", () => {
    window.location.href = "http://localhost/en-US/account?ref=menu";
    const historyLength = window.history.length;
    const view = renderLayout(<p>Account</p>);

    fireEvent.click(
      getDesktopNavigation(view).getByRole("link", {
        name: "Profile & Identity",
      })
    );

    expect(routerPush).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/en-US/account/profile");
    expect(window.location.search).toBe("?ref=menu");
    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: "Profile & Identity" })
        .getAttribute("aria-current")
    ).toBe("page");

    fireEvent.click(
      getDesktopNavigation(view).getByRole("link", { name: "Reservations" })
    );

    expect(window.location.pathname).toBe("/en-US/account/reservations");
    expect(window.location.search).toBe("?ref=menu");
    expect(window.history.length).toBe(historyLength);
  });

  test("titles the page after its path's section when Back restores a switched path", () => {
    pathname = "/en-US/account/legal";
    document.title = "Legal metadata";
    const view = renderLayout(<p>Legal</p>);
    expect(document.title).toBe("Legal metadata");

    // Back to a path a switch moved to restores the metadata of the section
    // the page was loaded at.
    pathname = "/en-US/account/billing";
    document.title = "Sign-in & security | My account | Deskohub Workspace";
    view.rerender(layoutElement(<p>Account from browser back</p>));
    expect(document.title).toBe(
      "Billing & Invoices | My account | Deskohub Workspace"
    );

    pathname = "/en-US/account/";
    view.rerender(layoutElement(<p>Account from browser back</p>));
    expect(document.title).toBe("My account | Deskohub Workspace");
  });

  test.each([
    { name: "a withheld section", path: "/en-US/account/security" },
    { name: "the deleted-account page", path: "/en-US/account/deleted" },
    { name: "a page outside the sections", path: "/en-US/account/unknown" },
  ])("leaves the title of $name to its page", ({ path }) => {
    pathname = path;
    document.title = "Page metadata";
    renderLayout(<p>Page</p>);

    expect(document.title).toBe("Page metadata");
  });

  test("never opens a withheld referral section, even at its path", () => {
    pathname = "/en-US/account/referrals";
    const view = renderLayout(<ReferralBadgePublisher section="referrals" />, {
      referralsEnabled: false,
    });

    expect(
      getDesktopNavigation(view).queryByRole("link", { name: /Referrals/ })
    ).toBeNull();
    expect(
      getMobileNavigation(view).queryByRole("link", { name: "Referrals" })
    ).toBeNull();
    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: "Reservations" })
        .getAttribute("aria-current")
    ).toBe("page");

    fireEvent.click(view.getByRole("button", { name: "Publish badge" }));
    fireEvent.click(view.getByRole("button", { name: "Open referrals" }));
    expect(view.queryByText("-15%")).toBeNull();
    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: "Reservations" })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(routerPush).not.toHaveBeenCalled();
  });

  test("opens the released referral section with its badge", () => {
    pathname = "/en-US/account/referrals";
    const view = renderLayout(<ReferralBadgePublisher />);

    fireEvent.click(view.getByRole("button", { name: "Publish badge" }));
    const referrals = getDesktopNavigation(view).getByRole("link", {
      name: /Referrals/,
    });
    expect(referrals.getAttribute("aria-current")).toBe("page");
    expect(within(referrals).getByText("-15%")).toBeTruthy();
  });

  test("withholds Sign-in & security while passkeys are off", () => {
    pathname = "/en-US/account/security";
    const view = renderLayout(<p>Account</p>);

    expect(
      getDesktopNavigation(view).queryByRole("link", {
        name: "Sign-in & security",
      })
    ).toBeNull();
    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: "Reservations" })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  test("opens Sign-in & security from its path while passkeys are on", () => {
    pathname = "/en-US/account/security";
    const view = renderLayout(<p>Account</p>, { passkeysEnabled: true });

    expect(
      getDesktopNavigation(view)
        .getByRole("link", { name: "Sign-in & security" })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  test("bypasses the frame on the deleted-account route", () => {
    pathname = "/en-US/account/deleted";
    const view = renderLayout(<p data-testid="deleted-content">Deleted</p>);

    expect(view.getByTestId("deleted-content")).toBeTruthy();
    expect(view.container.querySelector("main")).toBeNull();
    expect(view.container.querySelector("header")).toBeNull();
  });
});
