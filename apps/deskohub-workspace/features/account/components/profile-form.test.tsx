import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import React, { Activity, type ComponentPropsWithoutRef } from "react";
import type { CustomerProfileInput } from "@/features/account/contracts";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

type ProfileInput = { firstName?: string; lastName?: string; phone?: string };

type ActionResult = {
  data?: { status?: string };
  serverError?: string;
  validationErrors?: unknown;
};

const completeCustomerProfile = mock(() =>
  Promise.resolve({ data: { status: "completed" } })
);
const updateCustomerProfile = mock(() =>
  Promise.resolve({ data: { status: "updated" } })
);

mock.module("@/features/account/actions", () => ({
  completeCustomerProfile,
  updateCustomerProfile,
}));
mock.module("@/features/account/components/account-screen-copy", () => ({
  getAccountScreenCopy: (locale: "en-US" | "cs-CZ") => ({
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
  }),
}));

// A faithful stand-in for next-safe-action's hook contract so the component
// behaves as it does in the browser.
mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: never) => Promise<unknown>,
    options?: {
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
    }
  ) => {
    const [result, setResult] = React.useState<ActionResult>({});
    const [isExecuting, setExecuting] = React.useState(false);
    return {
      result,
      isExecuting,
      execute: (input: never) => {
        setExecuting(true);
        void action(input).then((outcome) => {
          setExecuting(false);
          setResult((outcome ?? {}) as ActionResult);
          const serverError = (outcome as { serverError?: string })
            ?.serverError;
          const validationErrors = (outcome as { validationErrors?: unknown })
            ?.validationErrors;
          if (serverError || validationErrors) return;
          options?.onSuccess?.({
            data: (outcome as { data?: unknown })?.data,
          });
        });
      },
      reset: () => setResult({}),
    };
  },
}));

type NavigateEvent = {
  readonly preventDefault: () => void;
};

type MockNextLinkProps = ComponentPropsWithoutRef<"a"> & {
  readonly href: string;
  readonly onNavigate?: (event: NavigateEvent) => void;
};

const MockNextLink = React.forwardRef<HTMLAnchorElement, MockNextLinkProps>(
  function MockNextLink(
    { children, href, onClick, onNavigate, ...props },
    ref
  ) {
    return (
      <a
        ref={ref}
        href={href}
        {...props}
        onClick={(event) => {
          onClick?.(event);
          const destination = new URL(href, window.location.href);
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            (event.currentTarget.target !== "" &&
              event.currentTarget.target !== "_self") ||
            event.currentTarget.hasAttribute("download") ||
            destination.origin !== window.location.origin
          ) {
            return;
          }
          onNavigate?.({
            preventDefault: () => event.preventDefault(),
          });
        }}
      >
        {children}
      </a>
    );
  }
);

mock.module("next/link", () => ({ default: MockNextLink }));

const { GuardedLink } = await import("@/shared/components/guarded-link");

const editProfile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+420601111222",
  billing: null,
};

const businessProfile = {
  ...editProfile,
  billing: {
    kind: "business" as const,
    addressLine1: "Original Street 1",
    addressLine2: null,
    city: "Prague",
    zip: "11000",
    country: "CZ",
    companyName: "Original Company",
    companyId: "12345678",
    vatId: null,
  },
};

const personalProfile = {
  ...editProfile,
  billing: {
    kind: "personal" as const,
    addressLine1: "Original Street 1",
    addressLine2: null,
    city: "Prague",
    zip: "11000",
    country: "CZ",
    companyName: null,
    companyId: null,
    vatId: null,
  },
};

describe("ProfileForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    completeCustomerProfile.mockClear();
    updateCustomerProfile.mockClear();
    workspaceRouterRefresh.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("labels the profile fields without required or optional suffixes", async () => {
    const { ProfileForm } = await import("./profile-form");

    const en = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    expect(en.getByLabelText("First name")).toBeTruthy();
    expect(en.getByLabelText("Last name")).toBeTruthy();
    expect(en.getByLabelText("Phone")).toBeTruthy();
    expect(en.getByText("Billing details")).toBeTruthy();
    en.unmount();

    const cs = render(
      <ProfileForm
        mode="edit"
        locale="cs-CZ"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    expect(cs.getByLabelText("Jméno")).toBeTruthy();
    expect(cs.getByLabelText("Příjmení")).toBeTruthy();
    expect(cs.getByLabelText("Telefon")).toBeTruthy();
    expect(cs.getByText("Fakturační údaje")).toBeTruthy();
  });

  test("renders the verified login email as immutable profile text", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    expect(view.getByText("ada@example.test")).toBeTruthy();
    expect(view.container.querySelector("#account-profile-email")).toBeNull();
    expect(
      view.queryByText(
        "To protect your reservation history, the login email cannot be changed."
      )
    ).toBeNull();
  });

  test("submits the profile without any email field for the completion mode", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm mode="complete" locale="en-US" email="ada@example.test" />
    );
    fireEvent.change(view.getByLabelText("First name"), {
      target: { value: "Ada" },
    });

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    expect(completeCustomerProfile).toHaveBeenCalledTimes(1);
    const input = completeCustomerProfile.mock.calls[0]![0] as ProfileInput;
    expect(input).toEqual({ firstName: "Ada" });
    expect(JSON.stringify(input)).not.toContain("email");
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    await view.findByText("Your customer profile was created and linked.");
  });

  test("keeps the full edit snapshot and drafts across identity and billing sections", async () => {
    const { ProfileForm } = await import("./profile-form");

    function SectionHarness() {
      const [section, setSection] = React.useState<"profile" | "billing">(
        "profile"
      );
      return (
        <>
          <button type="button" onClick={() => setSection("profile")}>
            Identity section
          </button>
          <button type="button" onClick={() => setSection("billing")}>
            Billing section
          </button>
          <ProfileForm
            email="ada@example.test"
            locale="en-US"
            mode="edit"
            profile={businessProfile}
            section={section}
          />
        </>
      );
    }

    const view = render(<SectionHarness />);
    fireEvent.input(view.getByLabelText("First name"), {
      target: { value: "Grace" },
    });
    fireEvent.input(view.getByLabelText("Last name"), {
      target: { value: "Byron" },
    });
    fireEvent.input(view.getByLabelText("Phone"), {
      target: { value: "+420602222333" },
    });
    fireEvent.click(view.getByRole("button", { name: "Billing section" }));

    await act(async () => {
      fireEvent.input(view.getByLabelText("Company name"), {
        target: { value: "Draft Company" },
      });
      fireEvent.input(view.getByLabelText("Company ID"), {
        target: { value: "87654321" },
      });
      fireEvent.input(view.getByLabelText("VAT ID"), {
        target: { value: "CZ87654321" },
      });
      fireEvent.input(view.getByLabelText("Street and number"), {
        target: { value: "Draft Street 2" },
      });
      fireEvent.input(view.getByLabelText("Apartment, suite"), {
        target: { value: "Suite 2" },
      });
      fireEvent.input(view.getByLabelText("City"), {
        target: { value: "Brno" },
      });
      fireEvent.input(view.getByLabelText("Postal code"), {
        target: { value: "60200" },
      });
      fireEvent.input(view.getByLabelText("Country code"), {
        target: { value: "CZ" },
      });
    });

    const form = view.container.querySelector(
      "#account-profile-form"
    ) as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(updateCustomerProfile).toHaveBeenCalledTimes(1);
    expect(updateCustomerProfile.mock.calls[0]?.[0]).toEqual({
      firstName: "Grace",
      lastName: "Byron",
      phone: "+420602222333",
      billing: {
        kind: "business",
        companyName: "Draft Company",
        companyId: "87654321",
        vatId: "CZ87654321",
        addressLine1: "Draft Street 2",
        addressLine2: "Suite 2",
        city: "Brno",
        zip: "60200",
        country: "CZ",
      },
    });
    expect(view.getByText("Profile updated.")).toBeTruthy();
    expect(
      view.container.querySelectorAll("#account-profile-feedback")
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll("#account-profile-submit")
    ).toHaveLength(1);
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole("button", { name: "Identity section" }));
    fireEvent.click(view.getByRole("button", { name: "Billing section" }));
    expect(
      (view.getByLabelText("Company name") as HTMLInputElement).value
    ).toBe("Draft Company");
    expect(
      (view.getByLabelText("Street and number") as HTMLInputElement).value
    ).toBe("Draft Street 2");
    expect(view.getByText("Profile updated.")).toBeTruthy();
  });

  test("returns to profile when a hidden required identity field is invalid", async () => {
    const { ProfileForm } = await import("./profile-form");

    function SectionHarness() {
      const [section, setSection] = React.useState<"profile" | "billing">(
        "profile"
      );
      return (
        <>
          <button type="button" onClick={() => setSection("profile")}>
            Identity section
          </button>
          <button type="button" onClick={() => setSection("billing")}>
            Billing section
          </button>
          <output data-testid="active-section">{section}</output>
          <ProfileForm
            email="ada@example.test"
            locale="en-US"
            mode="edit"
            onSectionChange={setSection}
            profile={businessProfile}
            section={section}
          />
        </>
      );
    }

    const view = render(<SectionHarness />);
    fireEvent.click(view.getByRole("button", { name: "Billing section" }));
    fireEvent.input(view.getByLabelText("Company name"), {
      target: { value: "Draft Company" },
    });
    fireEvent.input(view.getByLabelText("First name"), {
      target: { value: "" },
    });

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    const firstName = view.getByLabelText("First name") as HTMLInputElement;
    expect(updateCustomerProfile).not.toHaveBeenCalled();
    expect(view.getByTestId("active-section").textContent).toBe("profile");
    expect(firstName.validity.valid).toBe(false);
    expect(view.getByText("Enter your first name.")).toBeTruthy();
    expect(
      view.container.querySelector("[data-slot='profile-screen']")
        ?.parentElement?.hidden
    ).toBe(false);

    fireEvent.click(view.getByRole("button", { name: "Billing section" }));
    expect(
      (view.getByLabelText("Company name") as HTMLInputElement).value
    ).toBe("Draft Company");
  });

  test("returns to billing when a hidden required billing field is invalid", async () => {
    const { ProfileForm } = await import("./profile-form");

    function SectionHarness() {
      const [section, setSection] = React.useState<"profile" | "billing">(
        "profile"
      );
      return (
        <>
          <output data-testid="active-section">{section}</output>
          <ProfileForm
            email="ada@example.test"
            locale="en-US"
            mode="edit"
            onSectionChange={setSection}
            profile={businessProfile}
            section={section}
          />
        </>
      );
    }

    const view = render(<SectionHarness />);
    const companyName = view.getByLabelText("Company name") as HTMLInputElement;
    fireEvent.input(companyName, { target: { value: "" } });

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    expect(updateCustomerProfile).not.toHaveBeenCalled();
    expect(view.getByTestId("active-section").textContent).toBe("billing");
    expect(companyName.validity.valid).toBe(false);
    expect(
      view.getByRole("region", { name: "Billing & invoices" }).parentElement
        ?.hidden
    ).toBe(false);
  });

  test("keeps a deferred completion draft for the next update save", async () => {
    let resolveCompletion!: (result: ActionResult) => void;
    const pendingCompletion = new Promise<ActionResult>((resolve) => {
      resolveCompletion = resolve;
    });
    completeCustomerProfile.mockImplementationOnce(() => pendingCompletion);

    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="complete"
            locale="en-US"
            email="ada@example.test"
          />
          <GuardedLink href="/next">Next</GuardedLink>
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;
      const form = view.container.querySelector("#account-profile-form")!;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Ada" } });
        fireEvent.submit(form);
      });
      expect(
        (view.container.querySelector("fieldset") as HTMLFieldSetElement)
          .disabled
      ).toBe(false);
      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
      });

      await act(async () => {
        resolveCompletion({ data: { status: "completed" } });
        await pendingCompletion;
      });

      expect(firstName.value).toBe("Grace");
      expect(workspaceRouterRefresh).not.toHaveBeenCalled();
      const link = view.getByRole("link", { name: "Next" });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );

      await act(async () => {
        fireEvent.submit(form);
      });

      expect(completeCustomerProfile).toHaveBeenCalledTimes(1);
      expect(updateCustomerProfile).toHaveBeenCalledTimes(1);
      expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("disables the form during a delayed completion refresh", async () => {
    let refreshReleased = false;
    let releaseRefresh!: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      releaseRefresh = () => {
        refreshReleased = true;
        resolve();
      };
    });
    let requestRefresh!: () => void;
    workspaceRouterRefresh.mockImplementationOnce(() => requestRefresh());

    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );

    function DelayedRefresh({ requested }: { readonly requested: boolean }) {
      if (requested && !refreshReleased) throw refreshPromise;
      return null;
    }

    function RefreshFixture() {
      const [requested, setRequested] = React.useState(false);
      requestRefresh = () => setRequested(true);
      return (
        <UnsavedChangesProvider>
          <React.Suspense fallback={<p>Waiting for refresh</p>}>
            <DelayedRefresh requested={requested} />
            <ProfileForm
              mode="complete"
              locale="en-US"
              email="ada@example.test"
            />
          </React.Suspense>
        </UnsavedChangesProvider>
      );
    }

    const view = render(<RefreshFixture />);
    const firstName = view.getByLabelText("First name") as HTMLInputElement;
    const form = view.container.querySelector(
      "#account-profile-form"
    ) as HTMLFormElement;

    await act(async () => {
      fireEvent.input(firstName, { target: { value: "Ada" } });
      fireEvent.submit(form);
    });

    const fieldset = view.container.querySelector("fieldset")!;
    const submitButton = view.container.querySelector(
      "#account-profile-submit"
    )!;
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect((fieldset as HTMLFieldSetElement).disabled).toBe(true);
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      releaseRefresh();
      await refreshPromise;
    });

    expect((view.getByLabelText("First name") as HTMLInputElement).value).toBe(
      "Ada"
    );
    expect(form.getAttribute("aria-busy")).toBe("false");
    expect((fieldset as HTMLFieldSetElement).disabled).toBe(false);
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
  });

  test("keeps native required validation before executing", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm mode="complete" locale="en-US" email="ada@example.test" />
    );
    const form = view.container.querySelector("#account-profile-form")!;
    expect(
      (view.getByLabelText("First name") as HTMLInputElement).required
    ).toBe(true);
    expect((form as HTMLFormElement).noValidate).toBe(false);

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(completeCustomerProfile).not.toHaveBeenCalled();
  });

  test("keeps the update success feedback without refreshing the page", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    expect(updateCustomerProfile).toHaveBeenCalledTimes(1);
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
    expect(view.getByText("Profile updated.")).toBeTruthy();
  });

  test("reports action failures in the polite live region", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        serverError: "We could not update your profile. Please try again.",
      })
    );
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    const feedback = view.container.querySelector("#account-profile-feedback")!;
    expect(feedback.getAttribute("aria-live")).toBe("polite");

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    expect(
      view.getByText("We could not update your profile. Please try again.")
    ).toBeTruthy();
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
  });

  test("associates the first-name validation error with the field", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: {
          formErrors: [],
          fieldErrors: { firstName: ["Enter your first name."] },
        },
      })
    );
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    const firstName = view.getByLabelText("First name");
    expect(firstName.getAttribute("aria-invalid")).toBe("true");
    expect(firstName.getAttribute("aria-describedby")).toBe(
      "account-profile-first-name-error"
    );
    expect(view.getByText("Enter your first name.").id).toBe(
      "account-profile-first-name-error"
    );
  });

  test("renders the stored legacy phone so an unparseable value stays visible", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={{ ...editProfile, phone: "555-ALPHA" }}
      />
    );

    const phone = view.getByLabelText("Phone") as HTMLInputElement;
    expect(phone.value).toBe("555-ALPHA");
  });

  test("forces phone correction instead of saving when the phone fails validation", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: {
          formErrors: [],
          fieldErrors: {
            phone: ["Enter a valid phone number or clear the field."],
          },
        },
      })
    );
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={{ ...editProfile, phone: "555-ALPHA" }}
      />
    );

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    const phone = view.getByLabelText("Phone");
    expect(phone.getAttribute("aria-invalid")).toBe("true");
    expect(phone.getAttribute("aria-describedby")).toBe(
      "account-profile-phone-error"
    );
    expect(
      view.getByText("Enter a valid phone number or clear the field.").id
    ).toBe("account-profile-phone-error");
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
  });

  test("shows the validation message when the action rejects the input shape", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: { formErrors: [], fieldErrors: { firstName: [] } },
      })
    );
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );

    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    expect(
      view.getByText("Please review the highlighted fields and try again.")
    ).toBeTruthy();
  });

  test("keeps a later edit guarded when a deferred save succeeds", async () => {
    let resolveUpdate!: (result: ActionResult) => void;
    const pendingUpdate = new Promise<ActionResult>((resolve) => {
      resolveUpdate = resolve;
    });
    updateCustomerProfile.mockImplementationOnce(() => pendingUpdate);

    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
          <GuardedLink href="/next">Next</GuardedLink>
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
        fireEvent.submit(
          view.container.querySelector("#account-profile-form")!
        );
      });
      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Augusta" } });
      });

      await act(async () => {
        resolveUpdate({ data: { status: "updated" } });
        await pendingUpdate;
      });

      expect(firstName.value).toBe("Augusta");
      const link = view.getByRole("link", { name: "Next" });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("preserves typed values and the guard after a rejected save", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        serverError: "We could not update your profile. Please try again.",
      })
    );
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
          <GuardedLink href="/next">Next</GuardedLink>
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;
      const lastName = view.getByLabelText("Last name") as HTMLInputElement;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
        fireEvent.input(lastName, { target: { value: "Byron" } });
        fireEvent.submit(
          view.container.querySelector("#account-profile-form")!
        );
      });

      expect(firstName.value).toBe("Grace");
      expect(lastName.value).toBe("Byron");
      expect(
        view.getByText("We could not update your profile. Please try again.")
      ).toBeTruthy();

      const link = view.getByRole("link", { name: "Next" });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("preserves typed values and the guard after validation errors", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: {
          formErrors: [],
          fieldErrors: { firstName: ["Enter your first name."] },
        },
      })
    );
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
          <GuardedLink href="/next">Next</GuardedLink>
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
        fireEvent.submit(
          view.container.querySelector("#account-profile-form")!
        );
      });

      expect(firstName.value).toBe("Grace");
      expect(firstName.getAttribute("aria-invalid")).toBe("true");
      expect(
        view.getByText("Please review the highlighted fields and try again.")
      ).toBeTruthy();

      const link = view.getByRole("link", { name: "Next" });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("clears the guard after a successful save without extra edits", async () => {
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
          <GuardedLink href="/next">Next</GuardedLink>
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
        const form = view.container.querySelector("#account-profile-form")!;
        fireEvent.submit(form);
        fireEvent.submit(form);
      });

      expect(updateCustomerProfile).toHaveBeenCalledTimes(1);
      const link = view.getByRole("link", { name: "Next" });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(event.cancelBubble).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("clears the guard when a changed value returns to its original value", async () => {
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
          <GuardedLink href="/next">Next</GuardedLink>
        </UnsavedChangesProvider>
      );
      const firstName = view.getByLabelText("First name") as HTMLInputElement;

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
        fireEvent.input(firstName, { target: { value: "Ada" } });
      });

      const link = view.getByRole("link", { name: "Next" });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(event.cancelBubble).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("preserves the original baseline across Activity hide and show", async () => {
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      function ActivityHarness() {
        const [mode, setMode] = React.useState<"visible" | "hidden">("visible");
        return (
          <UnsavedChangesProvider>
            <button
              type="button"
              onClick={() =>
                setMode((currentMode) =>
                  currentMode === "visible" ? "hidden" : "visible"
                )
              }
            >
              Toggle activity
            </button>
            <Activity mode={mode}>
              <ProfileForm
                mode="edit"
                locale="en-US"
                email="ada@example.test"
                profile={editProfile}
              />
            </Activity>
            <GuardedLink href="/next">Next</GuardedLink>
          </UnsavedChangesProvider>
        );
      }

      const view = render(<ActivityHarness />);
      const firstName = view.getByLabelText("First name") as HTMLInputElement;
      const toggle = view.getByRole("button", { name: "Toggle activity" });

      await act(async () => {
        fireEvent.input(firstName, { target: { value: "Grace" } });
      });
      await act(async () => {
        fireEvent.click(toggle);
      });
      await act(async () => {
        fireEvent.click(toggle);
      });

      expect(
        (view.getByLabelText("First name") as HTMLInputElement).value
      ).toBe("Grace");
      await act(async () => {
        fireEvent.input(view.getByLabelText("First name"), {
          target: { value: "Ada" },
        });
      });

      const link = view.getByRole("link", { name: "Next" });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(event.cancelBubble).toBe(false);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("retains billing drafts when switching between business and personal", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={businessProfile}
      />
    );
    const companyName = view.getByLabelText("Company name") as HTMLInputElement;
    const addressLine1 = view.getByLabelText(
      "Street and number"
    ) as HTMLInputElement;

    await act(async () => {
      fireEvent.input(companyName, { target: { value: "Draft Company" } });
      fireEvent.input(addressLine1, { target: { value: "Draft Street 2" } });
    });
    expect(companyName.value).toBe("Draft Company");
    expect(addressLine1.value).toBe("Draft Street 2");
    await act(async () => {
      fireEvent.change(view.getByLabelText("Billing profile"), {
        target: { value: "personal" },
      });
    });
    expect(
      (view.getByLabelText("Street and number") as HTMLInputElement).value
    ).toBe("Draft Street 2");
    await act(async () => {
      fireEvent.change(view.getByLabelText("Billing profile"), {
        target: { value: "business" },
      });
    });

    expect(
      (view.getByLabelText("Company name") as HTMLInputElement).value
    ).toBe("Draft Company");
    expect(
      (view.getByLabelText("Street and number") as HTMLInputElement).value
    ).toBe("Draft Street 2");
  });

  test("retains a personal billing draft after hiding billing and stays dirty", async () => {
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={personalProfile}
          />
          <GuardedLink href="/next">Next</GuardedLink>
        </UnsavedChangesProvider>
      );
      const addressLine1 = view.getByLabelText(
        "Street and number"
      ) as HTMLInputElement;

      await act(async () => {
        fireEvent.input(addressLine1, { target: { value: "Draft Street 3" } });
        fireEvent.change(view.getByLabelText("Billing profile"), {
          target: { value: "hidden" },
        });
      });
      await act(async () => {
        fireEvent.change(view.getByLabelText("Billing profile"), {
          target: { value: "personal" },
        });
      });

      expect(
        (view.getByLabelText("Street and number") as HTMLInputElement).value
      ).toBe("Draft Street 3");
      const link = view.getByRole("link", { name: "Next" });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("submits only the active billing kind and keeps the saved baseline", async () => {
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={businessProfile}
          />
          <GuardedLink href="/next">Next</GuardedLink>
        </UnsavedChangesProvider>
      );
      const companyName = view.getByLabelText(
        "Company name"
      ) as HTMLInputElement;
      const addressLine1 = view.getByLabelText(
        "Street and number"
      ) as HTMLInputElement;

      await act(async () => {
        fireEvent.input(companyName, { target: { value: "Draft Company" } });
        fireEvent.input(addressLine1, { target: { value: "Draft Street 4" } });
        fireEvent.change(view.getByLabelText("Billing profile"), {
          target: { value: "personal" },
        });
      });
      await act(async () => {
        fireEvent.submit(
          view.container.querySelector("#account-profile-form")!
        );
      });

      const input = updateCustomerProfile.mock
        .calls[0]![0] as CustomerProfileInput;
      expect(input.billing?.kind).toBe("personal");
      expect(input.billing?.addressLine1).toBe("Draft Street 4");
      expect(input.billing && "companyName" in input.billing).toBe(false);

      await act(async () => {
        fireEvent.change(view.getByLabelText("Billing profile"), {
          target: { value: "business" },
        });
      });
      expect(
        (view.getByLabelText("Company name") as HTMLInputElement).value
      ).toBe("Draft Company");

      const link = view.getByRole("link", { name: "Next" });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("reveals business billing fields only after choosing business billing", async () => {
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={editProfile}
      />
    );
    expect(
      view.container.querySelector("#account-profile-billing-company-name")
    ).toBeNull();

    await act(async () => {
      fireEvent.change(view.getByLabelText("Billing profile"), {
        target: { value: "business" },
      });
    });

    expect(view.getByLabelText("Company name")).toBeTruthy();
    expect(view.getByLabelText("Company ID")).toBeTruthy();
    expect(view.getByLabelText("VAT ID")).toBeTruthy();
    expect(view.getByLabelText("Street and number")).toBeTruthy();

    fireEvent.change(view.getByLabelText("Billing profile"), {
      target: { value: "personal" },
    });
    expect(
      view.container.querySelector("#account-profile-billing-company-name")
    ).toBeNull();
    expect(view.getByLabelText("City")).toBeTruthy();
  });

  test("keeps billing address controls in responsive grid cells", async () => {
    updateCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        validationErrors: {
          formErrors: [],
          fieldErrors: {
            billing: [
              "companyName",
              "companyId",
              "vatId",
              "addressLine1",
              "addressLine2",
              "city",
              "zip",
              "country",
            ],
          },
        },
      })
    );
    const { ProfileForm } = await import("./profile-form");

    const view = render(
      <ProfileForm
        mode="edit"
        locale="en-US"
        email="ada@example.test"
        profile={businessProfile}
      />
    );
    const form = view.container.querySelector(
      "#account-profile-form"
    ) as HTMLFormElement;

    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    const fields = [
      [
        "Company name",
        "account-profile-billing-company-name",
        "billingCompanyName",
        "Original Company",
      ],
      [
        "Company ID",
        "account-profile-billing-company-id",
        "billingCompanyId",
        "12345678",
      ],
      ["VAT ID", "account-profile-billing-vat-id", "billingVatId", ""],
      [
        "Street and number",
        "account-profile-billing-address-line1",
        "billingAddressLine1",
        "Original Street 1",
      ],
      [
        "Apartment, suite",
        "account-profile-billing-address-line2",
        "billingAddressLine2",
        "",
      ],
      ["City", "account-profile-billing-city", "billingCity", "Prague"],
      ["Postal code", "account-profile-billing-zip", "billingZip", "11000"],
      [
        "Country code",
        "account-profile-billing-country",
        "billingCountry",
        "CZ",
      ],
    ] as const;

    expect(
      Array.from(
        view.container.querySelectorAll<HTMLInputElement>(
          "input[name^='billing']"
        ),
        (input) => input.name
      )
    ).toEqual(fields.map(([, , name]) => name));

    for (const [label, id, name, value] of fields) {
      const input = view.getByLabelText(label) as HTMLInputElement;
      expect(view.container.querySelectorAll(`#${id}`)).toHaveLength(1);
      expect(input.id).toBe(id);
      expect(input.name).toBe(name);
      expect(input.value).toBe(value);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(`${id}-error`);
      expect(view.container.querySelectorAll(`#${id}-error`)).toHaveLength(1);
    }
    expect(
      (view.getByLabelText("Country code") as HTMLInputElement).getAttribute(
        "autocomplete"
      )
    ).toBe("country");

    const addressLine1 = view.getByLabelText(
      "Street and number"
    ) as HTMLInputElement;
    const addressLine2 = view.getByLabelText(
      "Apartment, suite"
    ) as HTMLInputElement;
    const city = view.getByLabelText("City") as HTMLInputElement;
    const zip = view.getByLabelText("Postal code") as HTMLInputElement;
    const country = view.getByLabelText("Country code") as HTMLInputElement;
    const addressLine1Wrapper = addressLine1.parentElement!;
    const addressLine2Wrapper = addressLine2.parentElement!;
    const cityWrapper = city.parentElement!;
    const zipWrapper = zip.parentElement!;
    const countryWrapper = country.parentElement!;
    const outerGrid = addressLine1Wrapper.parentElement!;
    const zipCountryGrid = zipWrapper.parentElement!;

    expect(addressLine1Wrapper.classList.contains("sm:col-span-2")).toBe(false);
    expect(addressLine2Wrapper.classList.contains("sm:col-span-2")).toBe(false);
    expect(addressLine1Wrapper.classList.contains("min-w-0")).toBe(true);
    expect(addressLine2Wrapper.classList.contains("min-w-0")).toBe(true);
    expect(addressLine1Wrapper.parentElement).toBe(outerGrid);
    expect(addressLine2Wrapper.parentElement).toBe(outerGrid);
    expect(addressLine1Wrapper.nextElementSibling).toBe(addressLine2Wrapper);
    expect(outerGrid.classList.contains("grid")).toBe(true);
    expect(outerGrid.classList.contains("sm:grid-cols-2")).toBe(true);
    expect(outerGrid.classList.contains("grid-cols-2")).toBe(false);
    expect(cityWrapper.nextElementSibling).toBe(zipCountryGrid);
    expect(zipCountryGrid.parentElement).toBe(outerGrid);
    expect(zipCountryGrid.classList.contains("min-w-0")).toBe(true);
    expect(zipCountryGrid.classList.contains("grid")).toBe(true);
    expect(zipCountryGrid.classList.contains("gap-5")).toBe(true);
    expect(zipCountryGrid.classList.contains("sm:grid-cols-2")).toBe(true);
    expect(zipCountryGrid.classList.contains("grid-cols-2")).toBe(false);
    expect(zipWrapper.parentElement).toBe(zipCountryGrid);
    expect(countryWrapper.parentElement).toBe(zipCountryGrid);
  });

  test("blocks internal navigation after changing the profile", async () => {
    const { ProfileForm } = await import("./profile-form");
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.location.href = "http://localhost/account";
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          <ProfileForm
            mode="edit"
            locale="en-US"
            email="ada@example.test"
            profile={editProfile}
          />
          <GuardedLink href="/next">Next</GuardedLink>
        </UnsavedChangesProvider>
      );
      await act(async () => {
        fireEvent.input(view.getByLabelText("First name"), {
          target: { value: "Grace" },
        });
        await Promise.resolve();
      });

      const link = view.getByRole("link", { name: "Next" });
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved profile changes. Leave this page?"
      );
    } finally {
      window.confirm = originalConfirm;
    }
  });
});
