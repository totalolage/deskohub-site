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
import React from "react";
import type { CustomerProfileInput } from "@/features/account/contracts";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const updateCustomerProfile = mock((input: CustomerProfileInput) => {
  void input;
  return Promise.resolve({ data: { status: "updated" } });
});

mock.module("@/features/account/actions", () => ({
  completeCustomerProfile: () =>
    Promise.resolve({ data: { status: "completed" } }),
  deleteCustomerAccount: () => Promise.resolve({ data: { status: "deleted" } }),
  updateCustomerProfile,
}));

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signIn: { magicLink: () => Promise.resolve({ error: null }) },
    signOut: () => Promise.resolve({ error: null }),
  },
}));

mock.module("@/features/account/components/account-screen-copy", () => ({
  getAccountScreenCopy: () => ({
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
      billingDetailsTitle: "Billing details",
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
  }),
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: CustomerProfileInput) => Promise<unknown>,
    options?: {
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
    }
  ) => {
    const [result, setResult] = React.useState<{
      readonly data?: { readonly status?: string };
      readonly serverError?: string;
      readonly validationErrors?: unknown;
    }>({});
    const [isExecuting, setExecuting] = React.useState(false);

    return {
      result,
      isExecuting,
      execute: (input: CustomerProfileInput) => {
        setExecuting(true);
        void action(input).then((outcome) => {
          setExecuting(false);
          const nextResult = (outcome ?? {}) as {
            readonly data?: { readonly status?: string };
            readonly serverError?: string;
            readonly validationErrors?: unknown;
          };
          setResult(nextResult);
          if (!nextResult.serverError && !nextResult.validationErrors) {
            options?.onSuccess?.({ data: nextResult.data });
          }
        });
      },
      reset: () => setResult({}),
    };
  },
}));

function getDesktopSectionNavigation(view: {
  readonly container: HTMLElement;
}) {
  const navigation = view.container.querySelector<HTMLDivElement>("div.hidden");
  if (!navigation)
    throw new Error("Desktop account navigation was not rendered");
  return within(navigation);
}

const profile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+420601111222",
  billing: {
    kind: "business" as const,
    addressLine1: "Original Street 1",
    addressLine2: "Original Suite",
    city: "Prague",
    zip: "11000",
    country: "CZ",
    companyName: "Original Company",
    companyId: "12345678",
    vatId: "CZ12345678",
  },
};

const history = {
  kind: "available" as const,
  groups: {
    current: [
      {
        id: "current-1",
        product: { kind: "other" as const },
        startsAt: null,
        endsAt: null,
        seats: null,
        status: "confirmed" as const,
      },
    ],
    past: [],
    unavailable: [],
  },
};

describe("LinkedAccount", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    updateCustomerProfile.mockClear();
    workspaceRouterRefresh.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("mounts each panel once and keeps one profile form across navigation", async () => {
    const { LinkedAccount } = await import("./linked-account");
    const view = render(
      <LinkedAccount
        email="ada@example.test"
        history={history}
        locale="en-US"
        profile={profile}
      />
    );
    const sectionNavigation = within(
      view.getByRole("group", { name: "Account section" })
    );
    const desktopSectionNavigation = getDesktopSectionNavigation(view);

    expect(
      sectionNavigation.getByRole("button", { name: /^Reservations/ })
        .textContent
    ).toContain("Reservations");
    expect(
      desktopSectionNavigation.getByRole("button", { name: /^Reservations/ })
        .textContent
    ).toContain("1");
    expect(
      view.container.querySelectorAll("#account-profile-form")
    ).toHaveLength(1);
    expect(view.getByText("Need help?")).toBeTruthy();
    expect(view.container.textContent).toContain(
      "For help with your account or reservations, contact us."
    );
    expect(view.container.textContent).not.toContain(
      "We need to verify your profile"
    );
    expect(view.container.textContent).not.toContain(
      "We could not safely choose one customer profile"
    );
    expect(
      (
        view.getByRole("link", { name: "contact us" }) as HTMLAnchorElement
      ).getAttribute("href")
    ).toBe("/en-US/contact");

    fireEvent.click(
      sectionNavigation.getByRole("button", { name: "Profile & identity" })
    );
    const profileSubmit = view.getByRole("button", { name: "Save profile" });
    expect(profileSubmit.className).toContain("bg-burned-orange");
    expect(profileSubmit.className).toContain("h-9");
    expect(profileSubmit.className).toContain("rounded-xl");
    fireEvent.click(
      sectionNavigation.getByRole("button", { name: "Billing & invoices" })
    );
    const billingSubmit = view.getByRole("button", { name: "Save profile" });
    expect(billingSubmit.className).toContain("bg-navy-blue");
    expect(
      view.container.querySelector("[data-slot='profile-screen']")
        ?.parentElement?.hidden
    ).toBe(true);
    expect(
      view.container.querySelectorAll("#account-profile-feedback")
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll("#account-profile-submit")
    ).toHaveLength(1);

    fireEvent.click(
      sectionNavigation.getByRole("button", { name: /^Reservations/ })
    );
    expect(
      view.container.querySelector("#account-profile-form")?.parentElement
        ?.hidden
    ).toBe(true);
    fireEvent.click(
      sectionNavigation.getByRole("button", { name: "Legal & privacy" })
    );
    expect(view.getByText("Legal, privacy & GDPR consents")).toBeTruthy();
    fireEvent.click(
      sectionNavigation.getByRole("button", { name: "Danger zone" })
    );
    expect(view.getByText("Delete my account")).toBeTruthy();
  });

  test("returns to profile before saving an invalid hidden identity field", async () => {
    const { LinkedAccount } = await import("./linked-account");
    const view = render(
      <LinkedAccount
        email="ada@example.test"
        history={history}
        locale="en-US"
        profile={profile}
      />
    );
    const sectionNavigation = within(
      view.getByRole("group", { name: "Account section" })
    );

    fireEvent.click(
      sectionNavigation.getByRole("button", { name: "Billing & invoices" })
    );
    await act(async () => {
      fireEvent.input(view.getByLabelText("First name"), {
        target: { value: "" },
      });
    });

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    expect(updateCustomerProfile).not.toHaveBeenCalled();
    expect(
      view.container.querySelector("[data-slot='profile-screen']")
        ?.parentElement?.hidden
    ).toBe(false);
    expect(view.getByText("Enter your first name.")).toBeTruthy();
    expect(
      sectionNavigation
        .getByRole("button", { name: "Profile & identity" })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  test("keeps the unsaved-changes guard registered when the form is hidden", async () => {
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const { LinkedAccount } = await import("./linked-account");
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <LinkedAccount
            email="ada@example.test"
            history={history}
            locale="en-US"
            profile={profile}
          />
        </UnsavedChangesProvider>
      );
      const sectionNavigation = within(
        view.getByRole("group", { name: "Account section" })
      );

      fireEvent.click(
        sectionNavigation.getByRole("button", { name: "Profile & identity" })
      );
      await act(async () => {
        fireEvent.input(view.getByLabelText("First name"), {
          target: { value: "Grace" },
        });
      });
      fireEvent.click(
        sectionNavigation.getByRole("button", { name: /^Reservations/ })
      );

      const profilePanel = view.container.querySelector(
        "#account-profile-form"
      )?.parentElement;
      expect(profilePanel?.hidden).toBe(true);
      expect(
        (view.getByLabelText("First name") as HTMLInputElement).value
      ).toBe("Grace");

      const beforeUnload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(beforeUnload);
      expect(beforeUnload.defaultPrevented).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });
});
