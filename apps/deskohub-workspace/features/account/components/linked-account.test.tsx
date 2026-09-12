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
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import type { CustomerProfileInput } from "@/features/account/contracts";
import {
  workspaceRouterPush,
  workspaceRouterRefresh,
  workspaceRouterReplace,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

let workspacePathname = "/en-US/account";

mock.module("next/navigation", () => ({
  usePathname: () => workspacePathname,
  useRouter: () => ({
    push: workspaceRouterPush,
    refresh: workspaceRouterRefresh,
    replace: workspaceRouterReplace,
  }),
  useSearchParams: workspaceUseSearchParams,
  unstable_rethrow: (cause: unknown) => {
    throw cause;
  },
}));

mock.module("@/shared/components/guarded-link", () => ({
  GuardedLink: ({
    children,
    href,
  }: {
    readonly children: React.ReactNode;
    readonly href: string;
  }) => <a href={href}>{children}</a>,
}));

const updateCustomerProfile = mock((input: CustomerProfileInput) => {
  void input;
  return Promise.resolve({ data: { status: "updated" } });
});

let legalScreenMountCount = 0;

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
      emailLabel: "Email",
      emailVerification: {
        unverified: "This email still needs verification.",
        verified: "This email has been successfully verified.",
      },
      languageLabel: "Preferred communication language",
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

mock.module("@/features/account/components/legal/legal-screen", () => ({
  LegalScreen: ({
    locale,
    strings,
  }: {
    readonly locale: string;
    readonly strings: { readonly title: string };
  }) => {
    React.useEffect(() => {
      legalScreenMountCount += 1;
      return () => {
        legalScreenMountCount -= 1;
      };
    }, []);

    return (
      <>
        <h2>{strings.title}</h2>
        <a
          data-testid="privacy-policy-anchor"
          href={`/${locale}/privacy-policy`}
        >
          Privacy policy
        </a>
      </>
    );
  },
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

const { AccountLayoutShell, useAccountLayout } = await import(
  "./account-layout-shell"
);

function withAccountLayout(children: React.ReactNode) {
  return (
    <AccountLayoutShell accountsEnabled locale="en-US" signedIn>
      {children}
    </AccountLayoutShell>
  );
}

function ActivityAccountSectionProbe() {
  const { activeSection } = useAccountLayout();
  return (
    <output
      data-active-section={activeSection}
      data-testid="activity-account-section"
    >
      {activeSection}
    </output>
  );
}

describe("LinkedAccount", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    legalScreenMountCount = 0;
    updateCustomerProfile.mockClear();
    workspaceRouterPush.mockClear();
    workspaceRouterRefresh.mockClear();
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    workspacePathname = "/en-US/account";
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("mounts each panel once and keeps one profile form across navigation", async () => {
    const { LinkedAccount } = await import("./linked-account");
    const view = render(
      withAccountLayout(
        <LinkedAccount
          email="ada@example.test"
          history={history}
          locale="en-US"
          profile={profile}
        />
      )
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
    const helpHeadings = view.getAllByRole("heading", {
      level: 2,
      name: "Need help?",
    });
    expect(helpHeadings).toHaveLength(2);
    const helpContainers = helpHeadings.map(
      (heading) => heading.parentElement?.parentElement
    );
    const desktopHelpContainer = helpContainers.find((container) =>
      container?.className.includes("hidden md:block")
    );
    const mobileHelpContainer = helpContainers.find((container) =>
      container?.className.includes("md:hidden")
    );
    expect(desktopHelpContainer?.className).toBe(
      "mt-4 min-w-0 hidden md:block"
    );
    expect(mobileHelpContainer?.className).toBe("min-w-0 md:hidden");
    expect(view.container.textContent).toContain(
      "For help with your account or reservations, contact us."
    );
    expect(view.container.textContent).not.toContain(
      "We need to verify your profile"
    );
    expect(view.container.textContent).not.toContain(
      "We could not safely choose one customer profile"
    );
    const contactLinks = view.getAllByRole("link", { name: "contact us" });
    expect(contactLinks).toHaveLength(2);
    expect(contactLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/en-US/contact",
      "/en-US/contact",
    ]);

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
    expect(workspaceRouterPush).toHaveBeenCalledWith("/en-US/account/legal");
    fireEvent.click(
      sectionNavigation.getByRole("button", { name: "Danger zone" })
    );
    expect(view.getByText("Delete my account")).toBeTruthy();
  });

  test("clears the published reservation count when linked content unmounts", async () => {
    const { LinkedAccount } = await import("./linked-account");
    const view = render(
      withAccountLayout(
        <LinkedAccount
          email="ada@example.test"
          history={history}
          locale="en-US"
          profile={profile}
        />
      )
    );

    const reservations = getDesktopSectionNavigation(view).getByRole("button", {
      name: /^Reservations/,
    });
    expect(reservations.textContent).toContain("1");

    view.rerender(withAccountLayout(<p>Legal content</p>));

    expect(
      getDesktopSectionNavigation(view)
        .getByRole("button", { name: /^Reservations/ })
        .querySelector("span.ml-auto")
    ).toBeNull();
  });

  test("mounts legal only for the active section, including the legacy query", async () => {
    const { LinkedAccount } = await import("./linked-account");

    for (const section of [
      "reservations",
      "profile",
      "billing",
      "danger",
    ] as const) {
      workspaceUseSearchParams.mockReturnValue(
        new URLSearchParams(`section=${section}`)
      );
      const view = render(
        withAccountLayout(
          <LinkedAccount
            email="ada@example.test"
            history={history}
            locale="en-US"
            profile={profile}
          />
        )
      );

      expect(legalScreenMountCount).toBe(0);
      view.unmount();
    }

    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("section=legal")
    );
    render(
      withAccountLayout(
        <LinkedAccount
          email="ada@example.test"
          history={history}
          locale="en-US"
          profile={profile}
        />
      )
    );

    expect(legalScreenMountCount).toBe(1);
  });

  test.each([
    ["en-US", "/en-US/account", "/en-US/account/legal/"],
    ["cs-CZ", "/cs-CZ/account/", "/cs-CZ/account/legal"],
  ] as const)(
    "does not retain private legal content when public legal replaces it for %s",
    async (locale, privatePathname, publicLegalPathname) => {
      const { LinkedAccount } = await import("./linked-account");
      const { PublicAccountLegal } = await import("./public-account-legal");

      workspacePathname = privatePathname;
      workspaceUseSearchParams.mockReturnValue(
        new URLSearchParams("section=profile")
      );
      const privateAccount = (
        <div data-testid="cached-private-account">
          <LinkedAccount
            email="ada@example.test"
            history={history}
            locale={locale}
            profile={profile}
          />
          <ActivityAccountSectionProbe />
        </div>
      );
      const view = render(
        withAccountLayout(
          <>
            <React.Activity mode="visible">{privateAccount}</React.Activity>
            <div data-testid="public-account-legal-peer" />
          </>
        )
      );

      workspacePathname = publicLegalPathname;
      workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
      view.rerender(
        withAccountLayout(
          <>
            <React.Activity mode="hidden">{privateAccount}</React.Activity>
            <div data-testid="public-account-legal-peer">
              <PublicAccountLegal accountsEnabled locale={locale} />
            </div>
          </>
        )
      );

      await waitFor(() => {
        expect(
          view
            .getByTestId("activity-account-section")
            .getAttribute("data-active-section")
        ).toBe("legal");
      });

      const privacyPolicySelector =
        "a[data-testid='privacy-policy-anchor'][href$='/privacy-policy']";
      expect(
        view.container.querySelectorAll(privacyPolicySelector)
      ).toHaveLength(1);
      expect(
        view
          .getByTestId("cached-private-account")
          .querySelectorAll(privacyPolicySelector)
      ).toHaveLength(0);
      expect(
        view
          .getByTestId("public-account-legal-peer")
          .querySelectorAll(privacyPolicySelector)
      ).toHaveLength(1);
    }
  );

  test("confirms legal navigation before leaving a dirty profile form", async () => {
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const { LinkedAccount } = await import("./linked-account");
    const originalConfirm = window.confirm;
    const confirmDiscardChanges = mock(() => false);
    window.confirm = confirmDiscardChanges;

    try {
      const view = render(
        <UnsavedChangesProvider>
          {withAccountLayout(
            <LinkedAccount
              email="ada@example.test"
              history={history}
              locale="en-US"
              profile={profile}
            />
          )}
        </UnsavedChangesProvider>
      );
      const sectionNavigation = getDesktopSectionNavigation(view);

      fireEvent.click(
        sectionNavigation.getByRole("button", {
          name: "Profile & identity",
        })
      );
      await act(async () => {
        fireEvent.input(view.getByLabelText("First name"), {
          target: { value: "Grace" },
        });
      });
      const firstName = view.getByLabelText("First name") as HTMLInputElement;

      fireEvent.click(
        sectionNavigation.getByRole("button", { name: "Legal & privacy" })
      );

      expect(confirmDiscardChanges).toHaveBeenCalledTimes(1);
      expect(workspaceRouterPush).not.toHaveBeenCalled();
      expect(firstName.value).toBe("Grace");
      expect(
        sectionNavigation
          .getByRole("button", { name: "Profile & identity" })
          .getAttribute("aria-current")
      ).toBe("page");
      expect(updateCustomerProfile).not.toHaveBeenCalled();

      confirmDiscardChanges.mockImplementation(() => true);
      fireEvent.click(
        sectionNavigation.getByRole("button", { name: "Legal & privacy" })
      );

      expect(confirmDiscardChanges).toHaveBeenCalledTimes(2);
      expect(workspaceRouterPush).toHaveBeenCalledWith("/en-US/account/legal");
      expect(firstName.value).toBe("Grace");
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("reconciles query section changes without resetting the profile form", async () => {
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const { LinkedAccount } = await import("./linked-account");
    let query = new URLSearchParams("section=profile");
    workspaceUseSearchParams.mockImplementation(() => query);

    const renderAccount = () => (
      <UnsavedChangesProvider>
        {withAccountLayout(
          <LinkedAccount
            email="ada@example.test"
            history={history}
            locale="en-US"
            profile={profile}
          />
        )}
      </UnsavedChangesProvider>
    );
    const view = render(renderAccount());
    const sectionNavigation = getDesktopSectionNavigation(view);
    const firstName = view.getByLabelText("First name") as HTMLInputElement;

    await act(async () => {
      fireEvent.input(firstName, { target: { value: "Grace" } });
    });
    expect(firstName.value).toBe("Grace");

    query = new URLSearchParams("section=billing");
    await act(async () => {
      view.rerender(renderAccount());
    });
    expect(
      sectionNavigation
        .getByRole("button", { name: "Billing & invoices" })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(firstName.value).toBe("Grace");

    query = new URLSearchParams("section=legal");
    await act(async () => {
      view.rerender(renderAccount());
    });
    expect(
      sectionNavigation
        .getByRole("button", { name: "Legal & privacy" })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(firstName.value).toBe("Grace");

    query = new URLSearchParams("section=profile");
    await act(async () => {
      view.rerender(renderAccount());
    });
    expect(
      sectionNavigation
        .getByRole("button", { name: "Profile & identity" })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(firstName.value).toBe("Grace");
    expect(updateCustomerProfile).not.toHaveBeenCalled();
  });

  test.each([
    ["profile", "Profile & identity"],
    ["billing", "Billing & invoices"],
    ["danger", "Danger zone"],
  ] as const)(
    "starts on a valid %s section from the query",
    async (section, label) => {
      workspaceUseSearchParams.mockReturnValue(
        new URLSearchParams(`section=${section}`)
      );
      const { LinkedAccount } = await import("./linked-account");
      const view = render(
        withAccountLayout(
          <LinkedAccount
            email="ada@example.test"
            history={history}
            locale="en-US"
            profile={profile}
          />
        )
      );
      const sectionNavigation = getDesktopSectionNavigation(view);

      expect(
        sectionNavigation
          .getByRole("button", { name: label })
          .getAttribute("aria-current")
      ).toBe("page");
    }
  );

  test("falls back to reservations for an invalid section query", async () => {
    workspaceUseSearchParams.mockReturnValue(
      new URLSearchParams("section=not-a-section")
    );
    const { LinkedAccount } = await import("./linked-account");
    const view = render(
      withAccountLayout(
        <LinkedAccount
          email="ada@example.test"
          history={history}
          locale="en-US"
          profile={profile}
        />
      )
    );
    const sectionNavigation = getDesktopSectionNavigation(view);

    expect(
      sectionNavigation
        .getByRole("button", { name: /^Reservations/ })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  test("returns to profile before saving an invalid hidden identity field", async () => {
    const { LinkedAccount } = await import("./linked-account");
    const view = render(
      withAccountLayout(
        <LinkedAccount
          email="ada@example.test"
          history={history}
          locale="en-US"
          profile={profile}
        />
      )
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
          {withAccountLayout(
            <LinkedAccount
              email="ada@example.test"
              history={history}
              locale="en-US"
              profile={profile}
            />
          )}
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
