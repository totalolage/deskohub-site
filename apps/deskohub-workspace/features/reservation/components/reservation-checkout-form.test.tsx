import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import { type ComponentProps, useState } from "react";
import { useForm } from "react-hook-form";
import { discountIdSchema } from "@/features/discounts/contracts";
import { m } from "@/features/i18n";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ReservationExistingCustomerForm } from "../reservation-existing-customer";

const adaEmail = testEmailAddress("ada");
const graceEmail = testEmailAddress("grace");

const startCheckout = mock();
const verifyEmail = mock();
let initialStep: "selection" | "contact" = "contact";

mock.module("./use-reservation-checkout", () => ({
  useReservationCheckout: () => ({
    capturePrePaymentOutcome: mock(),
    clearSubmissionError: mock(),
    hasPreparedPayRedirect: false,
    isPreparingCheckout: false,
    isSubmittingCheckout: false,
    preparedCheckout: undefined,
    setSubmissionError: mock(),
    startCheckout,
    submissionError: undefined,
  }),
}));

mock.module("./use-checkout-email-verification", () => ({
  useCheckoutEmailVerification: () => ({
    clearError: mock(),
    error: undefined,
    isVerifying: false,
    verify: verifyEmail,
  }),
}));

// The step lives in the URL; the component test keeps it in state.
mock.module("./use-reservation-checkout-step", () => ({
  useReservationCheckoutStep: () => {
    const [step, setStep] = useState(initialStep);
    return { goTo: setStep, step };
  },
}));

// React DOM detects input events when it loads, so the DOM must exist first.
registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react/pure"
);
const { ReservationCheckoutForm } = await import("./reservation-checkout-form");

type HarnessValues = {
  readonly billing: {
    readonly purpose: "personal";
    readonly invoice: "none";
  };
  readonly date: string;
  readonly email: string;
  readonly marketingConsent: boolean;
  readonly name: string;
  readonly phone: string;
};

type CheckoutFormProps = ComponentProps<typeof ReservationCheckoutForm>;

const selectionSummary = {
  reservationTitle: "Open Space",
  rows: [{ label: "Date", value: "Tuesday, October 20, 2026" }],
};

function Harness({
  advertisedPrice,
  availability = { isPending: false },
  checkoutCustomer = { status: "signed-out" },
  date = "2026-10-20",
  values,
}: {
  readonly advertisedPrice: Pick<
    CheckoutFormProps["advertisedPrice"],
    "isError" | "token" | "sale"
  > &
    Partial<Pick<CheckoutFormProps["advertisedPrice"], "isFetching" | "retry">>;
  readonly availability?: CheckoutFormProps["availability"];
  readonly checkoutCustomer?: CheckoutFormProps["checkoutCustomer"];
  readonly date?: string;
  /** Contact values already in the form, as a restored checkout has them. */
  readonly values?: Partial<HarnessValues> & {
    readonly emailConfirmation?: string;
  };
}) {
  const contact =
    checkoutCustomer.status === "linked"
      ? checkoutCustomer.existingCustomer.contact
      : undefined;
  const form = useForm<HarnessValues>({
    defaultValues: {
      billing: { purpose: "personal", invoice: "none" },
      date,
      email:
        contact?.email ??
        (checkoutCustomer.status === "profile-missing"
          ? checkoutCustomer.email
          : ""),
      marketingConsent: false,
      name: contact?.name ?? "",
      phone: contact?.phone ?? "",
      ...values,
    },
  });

  return (
    <ReservationCheckoutForm
      advertisedPrice={{
        isFetching: false,
        retry: () => undefined,
        ...advertisedPrice,
      }}
      availability={availability}
      checkoutCustomer={checkoutCustomer}
      form={form}
      getReservation={({ email, name, phone }) =>
        ({ email, name, phone }) as never
      }
      locale="en-US"
      selectionSummary={selectionSummary}
      selection={{ kind: "cowork", fromSearchParams: () => ({}) }}
    >
      <input
        aria-label="Reservation date"
        {...form.register("date", { required: "Pick a date" })}
      />
    </ReservationCheckoutForm>
  );
}

const getSubmitButton = (view: ReturnType<typeof render>) =>
  view.container.querySelector("#reservation-submit") as HTMLButtonElement;

const getContinueButton = (view: ReturnType<typeof render>) =>
  view.container.querySelector("#reservation-continue") as HTMLButtonElement;

const getField = (
  view: ReturnType<typeof render>,
  name: "email" | "emailConfirmation" | "name" | "phone"
) => view.container.querySelector(`input[name="${name}"]`) as HTMLInputElement;

function RetryablePriceHarness() {
  const [price, setPrice] = useState({ isError: true, token: "stale-price" });

  return (
    <Harness
      advertisedPrice={{
        ...price,
        retry: () => setPrice({ isError: false, token: "fresh-price" }),
      }}
    />
  );
}

const money = (value: number) => ({ value, exponent: 2, currency: "CZK" });

const familySale = {
  discounts: [
    {
      discount: {
        id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
        label: "Summer sale",
        adjustment: { kind: "percentage" as const, basisPoints: 5000 },
      },
      subtotalBefore: money(29_000),
      amount: money(14_500),
      subtotalAfter: money(14_500),
    },
  ],
  productLabel: "Open Space",
};

const existingCustomer: ReservationExistingCustomerForm = {
  contact: {
    name: "Ada Lovelace",
    email: adaEmail,
    phone: "+420777777777",
  },
  hasMarketingConsent: false,
  initialMode: "account",
  otherContact: {
    name: "Grace Hopper",
    email: graceEmail,
    phone: "+420606060606",
  },
};

const linked = (
  overrides: Partial<ReservationExistingCustomerForm> = {}
): CheckoutFormProps["checkoutCustomer"] => ({
  status: "linked",
  existingCustomer: { ...existingCustomer, ...overrides },
  replacesTypedContact: false,
});

const signedPrice = { isError: false, token: "signed-price" } as const;

const getMarketingConsentCheckbox = (view: ReturnType<typeof render>) =>
  view.container.querySelector("#reservation-marketing-consent");

const en = { locale: "en-US" } as const;

describe("ReservationCheckoutForm", () => {
  afterEach(() => {
    cleanup();
    startCheckout.mockClear();
    verifyEmail.mockClear();
    workspaceRouterRefresh.mockClear();
    initialStep = "contact";
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  describe("choosing the space", () => {
    test("continues to the contact details with the selection summarized and kept", async () => {
      initialStep = "selection";
      const view = render(<Harness advertisedPrice={signedPrice} />);

      expect(
        (view.getByLabelText("Reservation date").closest("[hidden]") ??
          null) === null
      ).toBe(true);
      expect(getSubmitButton(view)).toBeNull();
      expect(view.queryByText("Open Space")).toBeNull();

      await act(async () => {
        fireEvent.click(getContinueButton(view));
      });

      await waitFor(() => expect(getSubmitButton(view)).not.toBeNull());
      expect(view.getByText("Open Space")).toBeDefined();
      expect(view.getByText("Tuesday, October 20, 2026")).toBeDefined();
      expect(
        view.getByLabelText("Reservation date").closest("[hidden]")
      ).not.toBeNull();

      fireEvent.click(
        view.getByRole("button", {
          name: m.reservationSelectionChange({}, en),
        })
      );
      expect(getContinueButton(view)).not.toBeNull();
      expect(
        (view.getByLabelText("Reservation date") as HTMLInputElement).value
      ).toBe("2026-10-20");
    });

    test("stays on the space while the selection is incomplete", async () => {
      initialStep = "selection";
      const view = render(<Harness advertisedPrice={signedPrice} date="" />);

      await act(async () => {
        fireEvent.click(getContinueButton(view));
      });

      expect(getSubmitButton(view)).toBeNull();
      expect(getContinueButton(view)).not.toBeNull();
    });

    test("blocks continuing and explains why when availability could not be confirmed", () => {
      initialStep = "selection";
      const availabilityError = m.reservationAvailabilityError({}, en);
      const view = render(
        <Harness
          advertisedPrice={signedPrice}
          availability={{
            isPending: false,
            unavailableMessage: availabilityError,
          }}
        />
      );

      expect(view.getByText(availabilityError)).toBeDefined();
      expect(getContinueButton(view).disabled).toBe(true);
      expect(
        getContinueButton(view).getAttribute("data-reservation-unavailable")
      ).toBe("true");
    });

    test("returns to the space when the selection went stale before submitting", async () => {
      const view = render(
        <Harness
          advertisedPrice={signedPrice}
          checkoutCustomer={linked()}
          date=""
        />
      );

      await act(async () => {
        fireEvent.click(getSubmitButton(view));
      });

      await waitFor(() => expect(getContinueButton(view)).not.toBeNull());
      expect(startCheckout).not.toHaveBeenCalled();
    });
  });

  test("re-enables submission once a failed advertised price is retried", async () => {
    const view = render(<RetryablePriceHarness />);

    expect(view.getByRole("alert").textContent).toContain(
      m.reservationAdvertisedPriceError({}, en)
    );
    expect(getSubmitButton(view).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.reservationAdvertisedPriceRetry({}, en),
        })
      );
    });

    expect(view.queryByRole("alert")).toBeNull();
    expect(getSubmitButton(view).disabled).toBe(false);
  });

  test("presents an advertised sale once around the whole form", () => {
    const view = render(
      <Harness advertisedPrice={{ ...signedPrice, sale: familySale }} />
    );

    const saleCard = view.container.querySelector(
      '[data-reservation-sale="active"]'
    );
    expect(saleCard?.contains(getSubmitButton(view))).toBe(true);
    expect(
      view.container.querySelectorAll("[data-reservation-sale-banner]")
    ).toHaveLength(1);
    const saleDiscount = saleCard?.querySelector(
      '[data-reservation-sale-discount="summer-sale"]'
    );
    expect(saleDiscount?.textContent).toBe("Summer sale -50%");
    expect(
      view.getByRole("button", {
        name: m.checkoutSummaryDiscountDetailsTrigger(
          { product: "Open Space" },
          en
        ),
      })
    ).toBeDefined();
  });

  describe("signed out", () => {
    test("verifies the email with the typed contact instead of booking", async () => {
      const view = render(
        <Harness
          advertisedPrice={signedPrice}
          values={{
            name: "Ada Lovelace",
            email: adaEmail,
            phone: "+420777777777",
          }}
        />
      );

      expect(
        view.getByText(m.reservationContactVerificationHint({}, en))
      ).toBeDefined();
      expect(
        view.getByRole("link", { name: "Sign in" }).getAttribute("href")
      ).toContain("/en-US/auth/sign-in?returnTo=");

      fireEvent.click(getMarketingConsentCheckbox(view) as Element);
      await act(async () => {
        fireEvent.click(getSubmitButton(view));
      });

      await waitFor(() => expect(verifyEmail).toHaveBeenCalledTimes(1));
      expect(verifyEmail.mock.calls[0]?.[0]).toEqual({
        name: "Ada Lovelace",
        email: adaEmail,
        phone: "+420777777777",
        billing: { purpose: "personal", invoice: "none" },
        marketingConsent: true,
      });
      expect(startCheckout).not.toHaveBeenCalled();
    });
  });

  describe("signed in without a profile", () => {
    test("books with the account email, which can't be changed", async () => {
      const view = render(
        <Harness
          advertisedPrice={signedPrice}
          checkoutCustomer={{
            status: "profile-missing",
            email: adaEmail,
            continuesCheckout: false,
          }}
          values={{ name: "Ada Lovelace" }}
        />
      );

      const email = getField(view, "email");
      expect(email.readOnly).toBe(true);
      expect(email.value).toBe(adaEmail);
      expect(getMarketingConsentCheckbox(view)).not.toBeNull();

      await act(async () => {
        fireEvent.click(getSubmitButton(view));
      });

      await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(1));
      expect(startCheckout.mock.calls[0]?.[0]).toMatchObject({
        customer: "account",
        reservation: { email: adaEmail, name: "Ada Lovelace" },
      });
      expect(verifyEmail).not.toHaveBeenCalled();
    });

    test("continues the verified contact to payment on its own once", async () => {
      const view = render(
        <Harness
          advertisedPrice={signedPrice}
          checkoutCustomer={{
            status: "profile-missing",
            email: adaEmail,
            continuesCheckout: true,
          }}
        />
      );

      await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(1));
      expect(startCheckout.mock.calls[0]?.[0]).toMatchObject({
        customer: "account",
      });
      view.rerender(
        <Harness
          advertisedPrice={signedPrice}
          checkoutCustomer={{
            status: "profile-missing",
            email: adaEmail,
            continuesCheckout: true,
          }}
        />
      );
      expect(startCheckout).toHaveBeenCalledTimes(1);
    });

    test("waits for the price before continuing on its own", async () => {
      const view = render(
        <Harness
          advertisedPrice={{ isError: false, token: undefined }}
          checkoutCustomer={{
            status: "profile-missing",
            email: adaEmail,
            continuesCheckout: true,
          }}
        />
      );

      expect(getSubmitButton(view).disabled).toBe(true);
      expect(startCheckout).not.toHaveBeenCalled();
    });
  });

  describe("signed in with a profile", () => {
    test("books as the account only while the account card is shown", async () => {
      const view = render(
        <Harness advertisedPrice={signedPrice} checkoutCustomer={linked()} />
      );

      fireEvent.click(getSubmitButton(view));
      await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(1));
      expect(startCheckout.mock.calls[0]?.[0]).toMatchObject({
        customer: "account",
        reservation: { email: adaEmail, name: "Ada Lovelace" },
      });

      fireEvent.click(
        view.getByRole("button", {
          name: m.reservationBookForSomeoneElse({}, en),
        })
      );
      fireEvent.click(getSubmitButton(view));
      await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(2));
      expect(startCheckout.mock.calls[1]?.[0]).not.toHaveProperty("customer");
      expect(startCheckout.mock.calls[1]?.[0]).toMatchObject({
        reservation: existingCustomer.otherContact,
      });
    });

    const renderSomeoneElse = (emailConfirmation: string) =>
      render(
        <Harness
          advertisedPrice={signedPrice}
          checkoutCustomer={linked({ initialMode: "contact" })}
          values={{ ...existingCustomer.otherContact, emailConfirmation }}
        />
      );

    test("asks someone else's email twice and books nothing while they differ", async () => {
      const view = renderSomeoneElse(adaEmail);

      expect(getField(view, "emailConfirmation")).not.toBeNull();
      await act(async () => {
        fireEvent.click(getSubmitButton(view));
      });

      expect(
        view.getByText(m.contactValidationEmailConfirmationMismatch({}, en))
      ).toBeDefined();
      expect(startCheckout).not.toHaveBeenCalled();
    });

    test("books for someone else once both emails match in any case", async () => {
      const view = renderSomeoneElse(graceEmail.toUpperCase());

      await act(async () => {
        fireEvent.click(getSubmitButton(view));
      });

      await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(1));
      expect(startCheckout.mock.calls[0]?.[0]).not.toHaveProperty("customer");
      // Someone else's contact is never asked, so no consent is sent.
      expect(startCheckout.mock.calls[0]?.[0]).not.toHaveProperty(
        "marketingConsent"
      );
      expect(startCheckout.mock.calls[0]?.[0]).toMatchObject({
        reservation: { email: graceEmail, name: "Grace Hopper" },
      });
    });

    test("asks an account without marketing consent to opt in, but not for someone else", () => {
      const view = render(
        <Harness advertisedPrice={signedPrice} checkoutCustomer={linked()} />
      );

      expect(getMarketingConsentCheckbox(view)).not.toBeNull();
      fireEvent.click(
        view.getByRole("button", {
          name: m.reservationBookForSomeoneElse({}, en),
        })
      );
      // Consent belongs to the account's own customer.
      expect(getMarketingConsentCheckbox(view)).toBeNull();
    });

    test("hides marketing consent for an account that already gave it", async () => {
      const view = render(
        <Harness
          advertisedPrice={signedPrice}
          checkoutCustomer={linked({ hasMarketingConsent: true })}
        />
      );

      expect(getMarketingConsentCheckbox(view)).toBeNull();
      // The hidden checkbox sends no consent fields, which leaves the stored
      // consent as it is.
      fireEvent.click(getSubmitButton(view));
      await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(1));
      const submitted = startCheckout.mock.calls[0]?.[0];
      expect(submitted).toMatchObject({ customer: "account" });
      expect(submitted).not.toHaveProperty("marketingConsent");
      expect(submitted).not.toHaveProperty("marketingConsentSource");
    });

    test("explains that a verified email's saved profile replaced the typed details", () => {
      const view = render(
        <Harness
          advertisedPrice={signedPrice}
          checkoutCustomer={
            { ...linked(), replacesTypedContact: true } as never
          }
        />
      );

      expect(
        view.getByText(m.reservationExistingProfileNotice({}, en))
      ).toBeDefined();
    });
  });

  test("offers a retry instead of a form when the account can't be read", async () => {
    const view = render(
      <Harness
        advertisedPrice={signedPrice}
        checkoutCustomer={{ status: "unavailable" }}
      />
    );

    expect(
      view.getByText(m.reservationAccountUnavailableTitle({}, en))
    ).toBeDefined();
    expect(
      view.queryByLabelText(new RegExp(`^${m.contactEmailLabel({}, en)}`))
    ).toBeNull();
    expect(getSubmitButton(view).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.reservationAccountUnavailableRetry({}, en),
        })
      );
    });
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
  });

  test("points to support instead of a form when the email's profile can't be linked", () => {
    const view = render(
      <Harness
        advertisedPrice={signedPrice}
        checkoutCustomer={{ status: "support-required" }}
      />
    );

    expect(
      view.getByText(m.reservationAccountSupportTitle({}, en))
    ).toBeDefined();
    expect(
      view.getByRole("button", { name: m.reservationSelectionChange({}, en) })
    ).toBeDefined();
    expect(
      view.queryByLabelText(new RegExp(`^${m.contactEmailLabel({}, en)}`))
    ).toBeNull();
    expect(
      view.queryByRole("button", {
        name: m.reservationAccountUnavailableRetry({}, en),
      })
    ).toBeNull();
    expect(
      view.queryByRole("group", { name: m.reservationPurposeLabel({}, en) })
    ).toBeNull();
    expect(view.queryByRole("link", { name: "Privacy Policy" })).toBeNull();
    expect(getMarketingConsentCheckbox(view)).toBeNull();
    expect(getSubmitButton(view)).toBeNull();
  });
});
