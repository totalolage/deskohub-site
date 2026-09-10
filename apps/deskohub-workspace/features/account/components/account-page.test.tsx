import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  workspaceRouterRefresh,
  workspaceRouterReplace,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CustomerAccountPageState } from "../page-data.server";

const signInMagicLink = mock(() => Promise.resolve({ error: null }));
const getSession = mock(() => Promise.resolve({ data: null, error: null }));
mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: () => ({
    execute: () => undefined,
    isExecuting: false,
    result: {},
    reset: () => undefined,
  }),
}));

mock.module("@/features/account/actions", () => ({
  completeCustomerProfile: () =>
    Promise.resolve({ data: { status: "completed" } }),
  updateCustomerProfile: () => Promise.resolve({ data: { status: "updated" } }),
  deleteCustomerAccount: () => Promise.resolve({ data: { status: "deleted" } }),
}));
const accountScreenCopy = (locale: "en-US" | "cs-CZ") => ({
  shell: {
    mobileSection: "Account section",
    navigation: "Account navigation",
    sections: {
      billing: "Billing & invoices",
      danger: "Danger zone",
      legal: "Legal & privacy",
      profile: "Profile & identity",
      reservations: "Reservations",
    },
  },
  profile: {
    avatarUnavailableDescription: "Profile photos are not available here.",
    avatarUnavailableLabel: "Profile photo unavailable",
    emailLabel: "Email address",
    languageLabel: "Preferred communication language",
    languageUnavailableDescription: "Language preferences are not saved yet.",
    languageUnavailableValue: "Not set",
    memberFallback: "Workspace member",
    title: "Profile & identity",
    verifiedEmail: "Verified login email",
  },
  billing: {
    addPaymentCard: "Add payment card",
    aresUnavailable: "ARES Registry sync is not available in this account.",
    billingDetailsTitle:
      locale === "cs-CZ" ? "Fakturační údaje" : "Billing details",
    currency: "Currency: CZK (Kč)",
    downloadInvoice: "Download PDF",
    exportInvoices: "Export all",
    invoiceHistoryTitle: "Invoice history",
    invoiceHistoryUnavailable:
      "Invoice history and downloads are not available in this account.",
    paymentMethodsTitle: "Saved payment methods",
    paymentMethodsUnavailable:
      "Saved payment methods are not available in this account.",
    removePaymentCard: "Remove payment card",
    syncAres: "Sync with ARES Registry",
    title: "Billing & invoices",
  },
  legal: {
    analyticsDescription:
      "Analytics preferences cannot be viewed or changed from your account.",
    analyticsTitle: "Web & usage analytics",
    archiveAction: "Request GDPR data archive",
    archiveDescription:
      "Requesting or downloading a personal data archive is not available in your account.",
    archiveTitle: "Your personal data archive",
    marketingDescription:
      "Communications consent cannot be viewed or changed from your account.",
    marketingTitle: "Marketing & community communications",
    preferencesUnavailable:
      "Account consent settings are not available here. Use cookie settings to manage this browser's cookies.",
    savePreferences: "Save consent preferences",
    title: "Legal, privacy & GDPR consents",
    unavailable: "Unavailable",
  },
  reservations: {
    assignedDesk: "Assigned desk",
    checkIn: "Check in",
    date: "Date",
    moreCurrent: "More upcoming reservations",
    nfcAccess: "NFC access",
    product: "Product",
    seats: "Seats",
    showPinCode: "Show PIN code",
    status: "Status",
    unavailable: "Unavailable",
    unsupportedDescription: "This access detail is not available yet.",
    validity: "Validity",
    viewReservation: "View reservation",
    wifi: "Wi-Fi",
  },
  dangerTitle: "Danger zone",
});
mock.module("@/features/account/components/account-screen-copy", () => ({
  getAccountScreenCopy: accountScreenCopy,
}));
mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signIn: { magicLink: signInMagicLink },
    signOut: () => Promise.resolve({ error: null }),
    getSession,
  },
}));
mock.module("@/shared/components/sticky-section", () => ({
  StickySection: ({ children }: { readonly children: ReactNode }) => (
    <div data-testid="sticky-section">{children}</div>
  ),
}));

const linkedState = {
  kind: "linked",
  email: "ada@example.test",
  profile: {
    firstName: "Ada",
    lastName: "Lovelace",
    phone: null,
    billing: null,
  },
  history: {
    kind: "available",
    groups: { current: [], past: [], unavailable: [] },
  },
} as const;

describe("AccountPage states", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    workspaceRouterRefresh.mockClear();
    workspaceRouterReplace.mockClear();
    getSession.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  const renderState = async (
    state: CustomerAccountPageState,
    locale: "en-US" | "cs-CZ" = "en-US"
  ) => {
    const { AccountPage } = await import("./account-page");
    return render(<AccountPage locale={locale} state={state} />);
  };

  test("asks for profile completion with the read-only verified email", async () => {
    const view = await renderState({
      kind: "completion-required",
      email: "ada@example.test",
    });

    expect(view.getByText("Complete your profile")).toBeTruthy();
    const email = view.getByLabelText(
      "Verified login email"
    ) as HTMLInputElement;
    expect(email.value).toBe("ada@example.test");
    expect(email.readOnly).toBe(true);
    expect(view.getByLabelText("First name")).toBeTruthy();
    expect(view.getByText("Sign out")).toBeTruthy();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Delete my account" }));
    });
    expect(
      view.getByRole("button", { name: "Delete permanently" })
    ).toBeTruthy();
  });

  test("renders the linked account with profile, reservations, sign out, and deletion", async () => {
    const view = await renderState(linkedState);
    const sectionNavigation = within(
      view.getByRole("group", { name: "Account section" })
    );

    expect(view.getByText("My Workspace")).toBeTruthy();
    expect(
      sectionNavigation.getByRole("button", { name: /^Reservations/ })
    ).toBeTruthy();
    expect(view.getByText("Delete my account")).toBeTruthy();
    expect(view.getByText("Sign out")).toBeTruthy();
    expect(view.container.querySelectorAll("main")).toHaveLength(1);

    fireEvent.click(
      sectionNavigation.getByRole("button", { name: "Profile & identity" })
    );
    expect(view.getByText("Save profile")).toBeTruthy();

    fireEvent.click(
      sectionNavigation.getByRole("button", { name: "Billing & invoices" })
    );
    expect(view.getByText("Billing details")).toBeTruthy();
    expect(view.getByText("Save profile")).toBeTruthy();

    view.unmount();
    const czechView = await renderState(linkedState, "cs-CZ");
    const czechSectionNavigation = within(
      czechView.getByRole("group", { name: "Account section" })
    );
    fireEvent.click(
      czechSectionNavigation.getByRole("button", {
        name: "Profile & identity",
      })
    );
    expect(czechView.getByText("Fakturační údaje")).toBeTruthy();
  });

  test("renders the support state with the contact destination and no profile data", async () => {
    const view = await renderState({
      kind: "support-required",
      email: "ada@example.test",
    });

    expect(view.getByText("We need to verify your profile")).toBeTruthy();
    const contact = view.getByRole("link", {
      name: "Contact us",
    }) as HTMLAnchorElement;
    expect(contact.getAttribute("href")).toBe("/en-US/contact");
    expect(view.queryByText("Save profile")).toBeNull();
    expect(view.queryByText("Reservations")).toBeNull();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Delete my account" }));
    });
    expect(
      view.getByRole("button", { name: "Delete permanently" })
    ).toBeTruthy();
  });

  test("renders the pending deletion state with retry and sign out", async () => {
    const view = await renderState({
      kind: "deletion-pending",
      email: "ada@example.test",
    });

    expect(view.getByText("Account deletion is pending")).toBeTruthy();
    expect(view.getByText("Delete permanently")).toBeTruthy();
    expect(view.getByText("Sign out")).toBeTruthy();
    expect(view.queryByText("Reservations")).toBeNull();
  });

  test("renders the unavailable state without any account data", async () => {
    const view = await renderState({ kind: "unavailable" });

    expect(
      view.getByText("Customer accounts are temporarily unavailable")
    ).toBeTruthy();
    expect(view.queryByText("My Workspace")).toBeNull();
    expect(view.queryByText("Sign out")).toBeNull();
    expect(view.queryByText("Delete my account")).toBeNull();
  });

  test("redirects unauthenticated visitors without loading session or account data", async () => {
    const view = await renderState({ kind: "unauthenticated" });

    expect(view.getByRole("status", { name: "Loading sign-in…" })).toBeTruthy();
    expect(workspaceRouterReplace).toHaveBeenCalledWith("/en-US/auth/sign-in");
    expect(getSession).not.toHaveBeenCalled();
    expect(view.queryByText("My Workspace")).toBeNull();
    expect(view.queryByText("Reservations")).toBeNull();
    expect(view.queryByText("Delete my account")).toBeNull();
    expect(view.queryByLabelText("Verified login email")).toBeNull();
    expect(view.container.textContent).not.toContain("ada@example.test");
  });

  test("renders the authenticated unavailable state with account controls", async () => {
    const view = await renderState({
      kind: "authenticated-unavailable",
      email: "ada@example.test",
    });

    expect(
      view.getByText("Customer accounts are temporarily unavailable")
    ).toBeTruthy();
    expect(view.getByText("My Workspace")).toBeTruthy();
    expect(view.getByText("Sign out")).toBeTruthy();
    expect(view.getByText("Delete my account")).toBeTruthy();
    expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      view.getByRole("heading", {
        level: 2,
        name: "Customer accounts are temporarily unavailable",
      })
    ).toBeTruthy();
  });

  test("asks the get-session route handler to roll the browser cookie once per authenticated view", async () => {
    await renderState(linkedState);
    expect(getSession).toHaveBeenCalledTimes(1);

    await renderState({ kind: "unavailable" });
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  test("swallows a failed get-session request instead of leaving an unhandled rejection", async () => {
    getSession.mockImplementationOnce(() =>
      Promise.reject(new Error("get-session unavailable"))
    );

    const view = await renderState(linkedState);
    await act(async () => {
      await Promise.resolve();
    });

    expect(view.container).toBeTruthy();
  });
});
