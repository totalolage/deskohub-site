import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import React, { type ComponentPropsWithoutRef } from "react";
import type { AresBusinessLookupResult } from "@/features/account/actions";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

type ActionResult = {
  data?: unknown;
  serverError?: string;
  validationErrors?: unknown;
};

const completeCustomerProfile = mock(() =>
  Promise.resolve({ data: { status: "completed" } })
);
const updateCustomerProfile = mock(() =>
  Promise.resolve({ data: { status: "updated" } })
);
type LookupOutcome = {
  readonly data?: AresBusinessLookupResult;
  readonly serverError?: string;
  readonly validationErrors?: unknown;
};

const lookupAresBusiness = mock(
  (): Promise<LookupOutcome> =>
    Promise.resolve({
      data: { status: "not-found", message: "No company was found." },
    })
);

mock.module("@/features/account/actions", () => ({
  completeCustomerProfile,
  lookupAresBusiness,
  updateCustomerProfile,
}));

mock.module("@/features/account/avatar-actions", () => ({
  removeCustomerAvatar: () => Promise.resolve({ data: null }),
  uploadCustomerAvatar: () => Promise.resolve({ data: null }),
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
      languageUnavailableValue: "Not set",
      memberFallback: "Workspace member",
      title: locale === "cs-CZ" ? "Profil a nastavení" : "Profile & identity",
      verifiedEmail: "Verified login email",
    },
    billing: {
      addPaymentCard: "Add payment card",
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
      title: locale === "cs-CZ" ? "Fakturace a faktury" : "Billing & invoices",
    },
    reservations: {
      assignedDesk: "Assigned desk",
      checkIn: "Check in",
      date: "Date",
      moreCurrent: "More upcoming reservations",
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

// Same faithful stand-in for next-safe-action's hook contract that the
// profile-form tests use, shared by the save and lookup actions alike.
mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: never) => Promise<unknown>,
    options?: {
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
      readonly onError?: (args: { readonly error: unknown }) => void;
      readonly onTransportError?: (args: { readonly error: unknown }) => void;
    }
  ) => {
    const [result, setResult] = React.useState<ActionResult>({});
    const [isExecuting, setExecuting] = React.useState(false);
    const execute = (input: never) => {
      setExecuting(true);
      void action(input)
        .then((outcome) => {
          setExecuting(false);
          setResult((outcome ?? {}) as ActionResult);
          const serverError = (outcome as { serverError?: string })
            ?.serverError;
          const validationErrors = (outcome as { validationErrors?: unknown })
            ?.validationErrors;
          if (serverError || validationErrors) {
            options?.onError?.({ error: outcome });
            return;
          }
          options?.onSuccess?.({
            data: (outcome as { data?: unknown })?.data,
          });
        })
        .catch((error) => {
          setExecuting(false);
          options?.onTransportError?.({ error });
        });
    };
    return {
      result,
      isExecuting,
      execute,
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
          onNavigate?.({ preventDefault: () => event.preventDefault() });
        }}
      >
        {children}
      </a>
    );
  }
);

mock.module("next/link", () => ({ default: MockNextLink }));

const { m } = await import("@/features/i18n");
const { ProfileForm } = await import("./profile-form");

const foundCompany = {
  companyName: "Studio Alpha s.r.o.",
  companyId: "27121043",
  vatId: "CZ27121043",
  addressLine1: "Řetězová 10/3",
  city: "Prague",
  zip: "11000",
  country: "CZ",
} as const;

const businessProfile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+420601111222",
  billing: {
    kind: "business" as const,
    addressLine1: "Original Street 1",
    addressLine2: "Suite 9",
    city: "Prague",
    zip: "11000",
    country: "CZ",
    companyName: "Original Company",
    companyId: "",
    vatId: "CZ12345678",
  },
};

type ProfileFixture = typeof businessProfile;

const renderForm = (
  props: { locale?: "en-US" | "cs-CZ"; profile?: ProfileFixture } = {}
) =>
  render(
    <ProfileForm
      email="ada@example.test"
      locale="en-US"
      mode="edit"
      profile={businessProfile}
      section="billing"
      {...props}
    />
  );

const companyIdInput = (
  view: ReturnType<typeof render>,
  locale: "en-US" | "cs-CZ" = "en-US"
) =>
  view.getByLabelText(
    m.accountAresLookupIcoLabel({}, { locale })
  ) as HTMLInputElement;

const lookupButton = (
  view: ReturnType<typeof render>,
  locale: "en-US" | "cs-CZ" = "en-US"
) =>
  view.getByRole("button", {
    name: m.accountAresLookupSubmit({}, { locale }),
  });

const applyButton = (
  view: ReturnType<typeof render>,
  locale: "en-US" | "cs-CZ" = "en-US"
) =>
  view.getByRole("button", {
    name: m.accountAresLookupApply({}, { locale }),
  });

const statusRegion = (view: ReturnType<typeof render>) =>
  view.container.querySelector("#account-profile-ares-status")!;

async function runLookup(
  view: ReturnType<typeof render>,
  result: AresBusinessLookupResult,
  options: { ico?: string; locale?: "en-US" | "cs-CZ" } = {}
) {
  const { ico = "27121043", locale = "en-US" } = options;
  let resolveLookup!: (result: AresBusinessLookupResult) => void;
  lookupAresBusiness.mockImplementationOnce(
    () =>
      new Promise<LookupOutcome>((resolve) => {
        resolveLookup = resolve;
      })
  );
  fireEvent.input(companyIdInput(view, locale), {
    target: { value: ico },
  });
  await act(async () => {
    fireEvent.click(lookupButton(view, locale));
    await Promise.resolve();
  });
  await act(async () => {
    resolveLookup({ data: result });
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  completeCustomerProfile.mockClear();
  lookupAresBusiness.mockReset();
  lookupAresBusiness.mockImplementation(() =>
    Promise.resolve({
      data: { status: "not-found", message: "No company was found." },
    })
  );
  updateCustomerProfile.mockClear();
  workspaceRouterRefresh.mockClear();
});

afterAll(unregisterWorkspaceComponentTestEnv);

describe("ProfileForm ARES business lookup", () => {
  test("reaches the lookup control by keyboard and applies a found company in en-US and cs-CZ", async () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const view = renderForm({ locale });
      await runLookup(
        view,
        { status: "found", company: { ...foundCompany } },
        {
          locale,
        }
      );

      expect(lookupAresBusiness).toHaveBeenCalledWith({ ico: "27121043" });
      expect(
        view.getByText(m.accountAresLookupReviewTitle({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.accountAresLookupApply({}, { locale }))
      ).toBeTruthy();

      const applyControl = applyButton(view, locale);
      companyIdInput(view, locale).focus();
      await act(async () => {
        fireEvent.keyDown(document.activeElement!, { key: "Tab" });
        (applyControl as HTMLElement).focus();
      });
      expect(document.activeElement).toBe(applyControl);

      await act(async () => {
        fireEvent.click(applyControl);
      });

      expect(
        view.container.querySelector<HTMLInputElement>(
          "#account-profile-billing-company-name"
        )!.value
      ).toBe(foundCompany.companyName);
      expect(
        view.container.querySelector<HTMLInputElement>(
          "#account-profile-billing-vat-id"
        )!.value
      ).toBe(foundCompany.vatId);
      expect(
        view.getByText(m.accountAresLookupApplied({}, { locale }))
      ).toBeTruthy();
      expect(
        view.queryByText(m.accountAresLookupReviewTitle({}, { locale }))
      ).toBeNull();
      view.unmount();
    }
  });

  test("applies only present fields and never clears absent draft values", async () => {
    const view = renderForm();
    await runLookup(view, {
      status: "found",
      company: {
        companyName: foundCompany.companyName,
        companyId: foundCompany.companyId,
        vatId: undefined,
        addressLine1: foundCompany.addressLine1,
        addressLine2: undefined,
        city: foundCompany.city,
        zip: foundCompany.zip,
        country: foundCompany.country,
      },
    });

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountAresLookupApply({}, { locale: "en-US" }),
        })
      );
    });

    expect(
      (view.getByLabelText("Company name") as HTMLInputElement).value
    ).toBe(foundCompany.companyName);
    expect((view.getByLabelText("VAT ID") as HTMLInputElement).value).toBe(
      "CZ12345678"
    );
    expect(
      (view.getByLabelText("Apartment, suite") as HTMLInputElement).value
    ).toBe("Suite 9");

    await act(async () => {
      fireEvent.input(view.getByLabelText("First name"), {
        target: { value: "Grace" },
      });
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
      await Promise.resolve();
    });

    expect(updateCustomerProfile).toHaveBeenCalledTimes(1);
    const input = updateCustomerProfile.mock.calls[0]![0] as {
      billing?: { vatId?: string; addressLine2?: string };
    };
    expect(input.billing?.vatId).toBe("CZ12345678");
    expect(input.billing?.addressLine2).toBe("Suite 9");
  });

  test("preserves concurrent edits elsewhere in the form while a lookup is pending", async () => {
    const view = renderForm();
    let resolveLookup!: (outcome: LookupOutcome) => void;
    lookupAresBusiness.mockImplementationOnce(
      () =>
        new Promise<LookupOutcome>((resolve) => {
          resolveLookup = resolve;
        })
    );

    fireEvent.input(companyIdInput(view), {
      target: { value: "27121043" },
    });
    await act(async () => {
      fireEvent.click(lookupButton(view));
      await Promise.resolve();
    });

    const lookupControl = view.getByRole("button", {
      name: m.accountAresLookupLoading({}, { locale: "en-US" }),
    }) as HTMLButtonElement;
    expect(lookupControl.disabled).toBe(true);
    expect(
      (view.getByLabelText("First name") as HTMLInputElement).disabled
    ).toBe(false);

    await act(async () => {
      fireEvent.input(view.getByLabelText("First name"), {
        target: { value: "Grace" },
      });
      fireEvent.input(view.getByLabelText("City"), {
        target: { value: "Brno" },
      });
      resolveLookup({
        data: {
          status: "found",
          company: { ...foundCompany, city: undefined },
        },
      });
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(applyButton(view));
    });

    expect((view.getByLabelText("First name") as HTMLInputElement).value).toBe(
      "Grace"
    );
    expect((view.getByLabelText("City") as HTMLInputElement).value).toBe(
      "Brno"
    );
    expect(
      (view.getByLabelText("Company name") as HTMLInputElement).value
    ).toBe(foundCompany.companyName);
  });

  test("discards a late lookup response when the company ID changes while it is pending", async () => {
    const view = renderForm();
    let resolveLookup!: (outcome: LookupOutcome) => void;
    lookupAresBusiness.mockImplementationOnce(
      () =>
        new Promise<LookupOutcome>((resolve) => {
          resolveLookup = resolve;
        })
    );

    fireEvent.input(companyIdInput(view), {
      target: { value: "27121043" },
    });
    await act(async () => {
      fireEvent.click(lookupButton(view));
      await Promise.resolve();
    });

    // The customer keeps typing while the lookup is in flight: the pending
    // response is now superseded and must never surface.
    await act(async () => {
      fireEvent.input(companyIdInput(view), {
        target: { value: "27082440" },
      });
      resolveLookup({
        data: { status: "found", company: { ...foundCompany } },
      });
      await Promise.resolve();
    });

    expect(
      view.queryByText(m.accountAresLookupReviewTitle({}, { locale: "en-US" }))
    ).toBeNull();
    expect(statusRegion(view).textContent).toBe("");
    expect(
      view.container.querySelector<HTMLInputElement>(
        "#account-profile-billing-company-name"
      )!.value
    ).toBe("Original Company");
    expect(
      view.queryByRole("button", {
        name: m.accountAresLookupApply({}, { locale: "en-US" }),
      })
    ).toBeNull();
  });

  test("a superseded found response can never be applied over the newer edit", async () => {
    const view = renderForm();
    let resolveLookup!: (outcome: LookupOutcome) => void;
    lookupAresBusiness.mockImplementationOnce(
      () =>
        new Promise<LookupOutcome>((resolve) => {
          resolveLookup = resolve;
        })
    );

    fireEvent.input(companyIdInput(view), { target: { value: "27121043" } });
    await act(async () => {
      fireEvent.click(lookupButton(view));
      await Promise.resolve();
    });

    // The IČO changes while the lookup is in flight: the later response is
    // superseded, so no review panel or apply control may appear at all.
    await act(async () => {
      fireEvent.input(companyIdInput(view), {
        target: { value: "27082440" },
      });
      resolveLookup({
        data: { status: "found", company: { ...foundCompany } },
      });
      await Promise.resolve();
    });

    expect(statusRegion(view).textContent).toBe("");
    expect(
      view.queryByText(m.accountAresLookupReviewTitle({}, { locale: "en-US" }))
    ).toBeNull();
    expect(
      view.queryByRole("button", {
        name: m.accountAresLookupApply({}, { locale: "en-US" }),
      })
    ).toBeNull();

    // The draft fields keep the customer's own values; submitting cannot
    // resurrect the discarded registry data either.
    await act(async () => {
      fireEvent.input(view.getByLabelText("First name"), {
        target: { value: "Grace" },
      });
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
      await Promise.resolve();
    });
    expect(updateCustomerProfile).toHaveBeenCalledTimes(1);
    const input = updateCustomerProfile.mock.calls[0]![0] as {
      billing?: { companyId?: string; companyName?: string };
    };
    expect(input.billing?.companyId).toBe("27082440");
    expect(input.billing?.companyName).toBe("Original Company");
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "surfaces the resolved server error in the live region for %s",
    async (locale) => {
      const view = renderForm({ locale });
      const serverErrorMessage = m.accountSessionExpired({}, { locale });
      lookupAresBusiness.mockImplementationOnce(() =>
        Promise.resolve({ serverError: serverErrorMessage })
      );

      await act(async () => {
        fireEvent.input(companyIdInput(view, locale), {
          target: { value: "27121043" },
        });
        fireEvent.click(lookupButton(view, locale));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(statusRegion(view).textContent).toBe(serverErrorMessage);
      expect(
        view.queryByRole("button", {
          name: m.accountAresLookupRetry({}, { locale }),
        })
      ).toBeTruthy();
    }
  );

  test("does not surface a superseded server error after the company ID changes mid-flight", async () => {
    const view = renderForm();
    let resolveLookup!: (outcome: LookupOutcome) => void;
    lookupAresBusiness.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve;
        })
    );

    fireEvent.input(companyIdInput(view), { target: { value: "27121043" } });
    await act(async () => {
      fireEvent.click(lookupButton(view));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.input(companyIdInput(view), {
        target: { value: "27082440" },
      });
      resolveLookup({
        serverError: "Your session has expired. Please sign in again.",
      });
      await Promise.resolve();
    });

    expect(statusRegion(view).textContent).toBe("");
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "announces the pending lookup and the found review in the live region for %s",
    async (locale) => {
      const view = renderForm({ locale });
      let resolveLookup!: (outcome: LookupOutcome) => void;
      lookupAresBusiness.mockImplementationOnce(
        () =>
          new Promise<LookupOutcome>((resolve) => {
            resolveLookup = resolve;
          })
      );

      fireEvent.input(companyIdInput(view, locale), {
        target: { value: "27121043" },
      });
      await act(async () => {
        fireEvent.click(lookupButton(view, locale));
        await Promise.resolve();
      });

      expect(statusRegion(view).textContent).toBe(
        m.accountAresLookupLoading({}, { locale })
      );

      await act(async () => {
        resolveLookup({
          data: { status: "found", company: { ...foundCompany } },
        });
        await Promise.resolve();
      });

      expect(statusRegion(view).textContent).toBe(
        m.accountAresLookupReviewReady({}, { locale })
      );
      expect(
        view.queryByRole("button", {
          name: m.accountAresLookupApply({}, { locale }),
        })
      ).toBeTruthy();
    }
  );

  test("surfaces the localized action error in the live region when the lookup execution fails", async () => {
    const view = renderForm();
    lookupAresBusiness.mockImplementationOnce(() =>
      Promise.reject(new TypeError("network down"))
    );

    await act(async () => {
      fireEvent.input(companyIdInput(view), {
        target: { value: "27121043" },
      });
      fireEvent.click(lookupButton(view));
      await Promise.resolve();
      await Promise.resolve();
    });

    const actionErrorMessage = m.accountAresLookupActionError(
      {},
      { locale: "en-US" }
    );
    expect(statusRegion(view).textContent).toContain(actionErrorMessage);
    expect(
      view.queryByText(m.accountAresLookupReviewTitle({}, { locale: "en-US" }))
    ).toBeNull();
  });

  test("dismisses the review when the company ID input changes", async () => {
    const view = renderForm();
    await runLookup(view, { status: "found", company: { ...foundCompany } });
    expect(
      view.getByText(m.accountAresLookupReviewTitle({}, { locale: "en-US" }))
    ).toBeTruthy();

    await act(async () => {
      fireEvent.input(companyIdInput(view), { target: { value: "12345678" } });
    });

    expect(
      view.queryByRole("button", {
        name: m.accountAresLookupApply({}, { locale: "en-US" }),
      })
    ).toBeNull();
  });

  test("dismisses the review when the billing kind changes", async () => {
    const view = renderForm();
    await runLookup(view, { status: "found", company: { ...foundCompany } });
    expect(
      view.getByText(m.accountAresLookupReviewTitle({}, { locale: "en-US" }))
    ).toBeTruthy();

    await act(async () => {
      fireEvent.change(view.getByLabelText("Billing profile"), {
        target: { value: "personal" },
      });
      fireEvent.change(view.getByLabelText("Billing profile"), {
        target: { value: "business" },
      });
    });

    expect(
      view.queryByRole("button", {
        name: m.accountAresLookupApply({}, { locale: "en-US" }),
      })
    ).toBeNull();
  });

  test("links the invalid-ICO message to the field and moves focus there", async () => {
    const view = renderForm();
    const invalidMessage = m.accountAresLookupInvalidIco(
      {},
      { locale: "en-US" }
    );
    await runLookup(view, {
      status: "invalid-ico",
      message: invalidMessage,
    });

    const input = companyIdInput(view);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(
      "account-profile-ares-status"
    );
    expect(statusRegion(view).getAttribute("aria-live")).toBe("polite");
    expect(statusRegion(view).textContent).toContain(invalidMessage);
    expect(document.activeElement).toBe(input);
  });

  test.each(["not-found", "unavailable"] as const)(
    "reports %s in the live region and offers an explicit retry",
    async (status) => {
      const view = renderForm();
      const message =
        status === "not-found"
          ? m.accountAresLookupNotFound({}, { locale: "en-US" })
          : m.accountAresLookupUnavailable({}, { locale: "en-US" });
      await runLookup(view, { status, message });

      expect(statusRegion(view).textContent).toContain(message);
      const retryButton = view.getByRole("button", {
        name: m.accountAresLookupRetry({}, { locale: "en-US" }),
      }) as HTMLButtonElement;
      expect(retryButton.disabled).toBe(false);

      await act(async () => {
        fireEvent.click(retryButton);
        await Promise.resolve();
      });
      expect(lookupAresBusiness).toHaveBeenCalledTimes(2);
      expect(lookupAresBusiness.mock.calls[1]![0]).toEqual({
        ico: "27121043",
      });
    }
  );
});
