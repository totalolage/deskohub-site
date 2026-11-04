import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import { type ComponentProps, useState } from "react";
import { useForm } from "react-hook-form";
import type { SiteToolReservationForm } from "@/features/agent-tools/webmcp/use-prepare-reservation-site-tool";
import { discountIdSchema } from "@/features/discounts/contracts";
import { m } from "@/features/i18n";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ReservationExistingCustomerForm } from "../reservation-existing-customer";
import type { useReservationCheckout } from "./use-reservation-checkout";

const adaEmail = testEmailAddress("ada");
const graceEmail = testEmailAddress("grace");

type CheckoutDetails = Parameters<
  ReturnType<typeof useReservationCheckout>["startCheckout"]
>[0];

const startCheckout = mock(
  async (_details: CheckoutDetails) =>
    ({ status: "error", message: "Started" }) as const
);
const verifyEmail = mock();
const capturePrePaymentOutcome = mock((_outcome: string) => undefined);
const clearSubmissionError = mock(() => undefined);
const setSubmissionError = mock((_message: string) => undefined);
const clearEmailVerificationError = mock(() => undefined);
let initialStep: "selection" | "contact" = "contact";
let checkoutState: {
  hasPreparedPayRedirect?: boolean;
  isPreparingCheckout?: boolean;
  isSubmittingCheckout?: boolean;
  preparedCheckout?: unknown;
  submissionError?: string;
} = {};
let emailVerificationState: { error?: string; isVerifying?: boolean } = {};
let siteTool: SiteToolReservationForm | undefined;

mock.module("./use-reservation-checkout", () => ({
  useReservationCheckout: () => ({
    capturePrePaymentOutcome,
    clearSubmissionError,
    hasPreparedPayRedirect: false,
    isPreparingCheckout: false,
    isSubmittingCheckout: false,
    preparedCheckout: undefined,
    setSubmissionError,
    startCheckout,
    submissionError: undefined,
    ...checkoutState,
  }),
}));

mock.module("./use-checkout-email-verification", () => ({
  useCheckoutEmailVerification: () => ({
    clearError: clearEmailVerificationError,
    error: undefined,
    isVerifying: false,
    verify: verifyEmail,
    ...emailVerificationState,
  }),
}));

// The site tool's form is the same submission path the button takes; tests
// call it directly to read each submission's outcome.
mock.module(
  "@/features/agent-tools/webmcp/use-prepare-reservation-site-tool",
  () => ({
    usePrepareReservationSiteTool: (form: SiteToolReservationForm) => {
      siteTool = form;
    },
  })
);

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
  fromSearchParams = () => ({}),
  requiresName = false,
  values,
}: {
  /** Validates the name with a resolver, as a family's schema does. */
  readonly requiresName?: boolean;
  readonly fromSearchParams?: CheckoutFormProps["selection"]["fromSearchParams"];
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
    ...(requiresName && {
      resolver: async (values: HarnessValues) =>
        values.name
          ? { values, errors: {} }
          : {
              values: {},
              errors: { name: { type: "required", message: "Enter a name" } },
            },
    }),
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
      selection={{ kind: "cowork", fromSearchParams }}
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
    capturePrePaymentOutcome.mockClear();
    clearSubmissionError.mockClear();
    setSubmissionError.mockClear();
    clearEmailVerificationError.mockClear();
    workspaceRouterRefresh.mockClear();
    initialStep = "contact";
    checkoutState = {};
    emailVerificationState = {};
    siteTool = undefined;
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

  describe("submission outcomes", () => {
    const submit = (marketingConsentSource?: "site_tool") =>
      act(async () => siteTool?.submit(marketingConsentSource));

    test("returns a checkout already prepared without checking again", async () => {
      const prepared = {
        status: "ready",
        redirectUrl: "/en-US/checkout/pay",
        expiresAt: "2099-01-01T00:00:00Z",
      };
      checkoutState = { preparedCheckout: prepared };
      render(
        <Harness
          advertisedPrice={{ isError: false, token: undefined }}
          checkoutCustomer={linked()}
        />
      );

      expect(await submit()).toBe(prepared as never);
      expect(clearSubmissionError).not.toHaveBeenCalled();
      expect(capturePrePaymentOutcome).not.toHaveBeenCalled();
      expect(startCheckout).not.toHaveBeenCalled();
    });

    test("names the invalid fields and returns a stale selection to its step", async () => {
      const view = render(
        <Harness
          advertisedPrice={signedPrice}
          checkoutCustomer={linked()}
          date=""
        />
      );

      expect(await submit()).toEqual({
        status: "invalid",
        fields: [{ name: "date", message: "Pick a date" }],
      });
      expect(capturePrePaymentOutcome.mock.calls).toEqual([["validation"]]);
      expect(getContinueButton(view)).not.toBeNull();
    });

    test("stays on the contact step for an invalid contact field", async () => {
      const view = render(
        <Harness advertisedPrice={signedPrice} requiresName />
      );

      expect(await submit()).toEqual({
        status: "invalid",
        fields: [{ name: "name", message: "Enter a name" }],
      });
      expect(getSubmitButton(view)).not.toBeNull();
      expect(verifyEmail).not.toHaveBeenCalled();
    });

    test("rejects someone else's mismatched email confirmation first", async () => {
      render(
        <Harness
          advertisedPrice={{ isError: false, token: undefined }}
          availability={{ isPending: false, unavailableMessage: "Taken" }}
          checkoutCustomer={linked({ initialMode: "contact" })}
          values={{
            ...existingCustomer.otherContact,
            emailConfirmation: adaEmail,
          }}
        />
      );

      expect(await submit()).toEqual({
        status: "invalid",
        fields: [
          {
            name: "emailConfirmation",
            message: m.contactValidationEmailConfirmationMismatch({}, en),
          },
        ],
      });
      expect(clearSubmissionError).toHaveBeenCalledTimes(1);
      expect(clearEmailVerificationError).toHaveBeenCalledTimes(1);
      expect(capturePrePaymentOutcome.mock.calls).toEqual([["validation"]]);
      expect(setSubmissionError).not.toHaveBeenCalled();
    });

    test("reports a selection that became unavailable before the price", async () => {
      render(
        <Harness
          advertisedPrice={{ isError: false, token: undefined }}
          availability={{ isPending: false, unavailableMessage: "Taken" }}
          checkoutCustomer={linked()}
        />
      );

      expect(await submit()).toEqual({ status: "error", message: "Taken" });
      expect(capturePrePaymentOutcome.mock.calls).toEqual([
        ["availability_changed"],
      ]);
      expect(setSubmissionError.mock.calls).toEqual([["Taken"]]);
      expect(startCheckout).not.toHaveBeenCalled();
    });

    test("fails without a signed price", async () => {
      render(
        <Harness
          advertisedPrice={{ isError: true, token: undefined }}
          checkoutCustomer={linked()}
        />
      );

      const message = m.reservationErrorMessage({}, en);
      expect(await submit()).toEqual({ status: "error", message });
      expect(capturePrePaymentOutcome.mock.calls).toEqual([
        ["transport_error"],
      ]);
      expect(setSubmissionError.mock.calls).toEqual([[message]]);
      expect(startCheckout).not.toHaveBeenCalled();
    });

    test("verifies a signed-out customer's email instead of checking out", async () => {
      render(
        <Harness
          advertisedPrice={signedPrice}
          values={{
            name: "Ada Lovelace",
            email: adaEmail,
            phone: "+420777777777",
          }}
        />
      );

      expect(await submit("site_tool")).toEqual({
        status: "email-verification",
      });
      expect(verifyEmail).toHaveBeenCalledTimes(1);
      expect(startCheckout).not.toHaveBeenCalled();
      expect(capturePrePaymentOutcome).not.toHaveBeenCalled();
    });

    test("labels the consent the site tool gave and returns the started checkout", async () => {
      render(
        <Harness
          advertisedPrice={signedPrice}
          checkoutCustomer={linked()}
          values={{ marketingConsent: true }}
        />
      );

      expect(await submit("site_tool")).toEqual({
        status: "error",
        message: "Started",
      });
      expect(startCheckout.mock.calls).toEqual([
        [
          {
            advertisedPriceToken: "signed-price",
            customer: "account",
            marketingConsent: true,
            marketingConsentSource: "site_tool",
            reservation: {
              email: adaEmail,
              name: "Ada Lovelace",
              phone: "+420777777777",
            },
          },
        ],
      ]);
    });

    test("sends a declined consent without a source", async () => {
      render(
        <Harness advertisedPrice={signedPrice} checkoutCustomer={linked()} />
      );

      await submit("site_tool");

      expect(startCheckout.mock.calls[0]?.[0]).toEqual({
        advertisedPriceToken: "signed-price",
        customer: "account",
        marketingConsent: false,
        reservation: {
          email: adaEmail,
          name: "Ada Lovelace",
          phone: "+420777777777",
        },
      });
    });

    test("books someone else without the account or consent", async () => {
      render(
        <Harness
          advertisedPrice={signedPrice}
          checkoutCustomer={linked({ initialMode: "contact" })}
          values={{
            ...existingCustomer.otherContact,
            emailConfirmation: graceEmail,
            marketingConsent: true,
          }}
        />
      );

      await submit("site_tool");

      expect(startCheckout.mock.calls[0]?.[0]).toEqual({
        advertisedPriceToken: "signed-price",
        reservation: existingCustomer.otherContact,
      });
    });
  });

  describe("site tool", () => {
    test("reports readiness from availability and the price", () => {
      const view = render(<Harness advertisedPrice={signedPrice} />);
      expect(siteTool?.readiness).toEqual({
        isPending: false,
        priceError: false,
        unavailableMessage: undefined,
      });
      expect(siteTool).toMatchObject({
        asksMarketingConsent: true,
        kind: "cowork",
        locale: "en-US",
      });

      for (const [props, isPending] of [
        [{ availability: { isPending: true } }, true],
        [{ advertisedPrice: { ...signedPrice, isFetching: true } }, true],
        [{ advertisedPrice: { isError: false, token: undefined } }, true],
        [{ advertisedPrice: { isError: true, token: undefined } }, false],
      ] as const) {
        view.rerender(<Harness advertisedPrice={signedPrice} {...props} />);
        expect(siteTool?.readiness.isPending).toBe(isPending);
      }
      expect(siteTool?.readiness.priceError).toBe(true);

      view.rerender(
        <Harness
          advertisedPrice={signedPrice}
          availability={{ isPending: false, unavailableMessage: "Taken" }}
        />
      );
      expect(siteTool?.readiness.unavailableMessage).toBe("Taken");
    });

    test("reads and gives marketing consent on the form", () => {
      const view = render(<Harness advertisedPrice={signedPrice} />);

      expect(siteTool?.hasMarketingConsent()).toBe(false);
      act(() => siteTool?.giveMarketingConsent());
      expect(siteTool?.hasMarketingConsent()).toBe(true);
      expect(
        getMarketingConsentCheckbox(view)?.getAttribute("data-state")
      ).toBe("checked");
    });

    test("applies a link's selection and says whether anything changed", () => {
      const fromSearchParams = mock((searchParams: URLSearchParams) => ({
        date: searchParams.get("date") ?? undefined,
      }));
      render(
        <Harness
          advertisedPrice={signedPrice}
          fromSearchParams={fromSearchParams as never}
        />
      );
      const dateField = () =>
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Reservation date"]'
        );

      let changed: boolean | undefined;
      act(() => {
        changed = siteTool?.applySelection(
          new URLSearchParams({ date: "2026-10-20" })
        );
      });
      expect(changed).toBe(false);

      act(() => {
        changed = siteTool?.applySelection(
          new URLSearchParams({ date: "2026-10-25" })
        );
      });
      expect(changed).toBe(true);
      expect(dateField()?.value).toBe("2026-10-25");
    });
  });

  describe("submit button", () => {
    test("disables while checkout is busy or the selection unconfirmed", () => {
      const view = render(
        <Harness advertisedPrice={signedPrice} checkoutCustomer={linked()} />
      );
      expect(getSubmitButton(view).disabled).toBe(false);

      for (const state of [
        { checkout: { isSubmittingCheckout: true } },
        { checkout: { hasPreparedPayRedirect: true } },
        { emailVerification: { isVerifying: true } },
      ]) {
        checkoutState = state.checkout ?? {};
        emailVerificationState = state.emailVerification ?? {};
        view.rerender(
          <Harness advertisedPrice={signedPrice} checkoutCustomer={linked()} />
        );
        expect(getSubmitButton(view).disabled).toBe(true);
      }
      checkoutState = {};
      emailVerificationState = {};

      for (const props of [
        { availability: { isPending: true } },
        { advertisedPrice: { ...signedPrice, isFetching: true } },
        { advertisedPrice: { isError: true, token: "stale-price" } },
      ]) {
        view.rerender(
          <Harness
            advertisedPrice={signedPrice}
            checkoutCustomer={linked()}
            {...props}
          />
        );
        expect(getSubmitButton(view).disabled).toBe(true);
      }
    });

    test("shows a checkout or email verification error", () => {
      checkoutState = { submissionError: "Checkout failed" };
      emailVerificationState = { error: "Email failed" };
      const view = render(<Harness advertisedPrice={signedPrice} />);
      expect(view.getByRole("alert").textContent).toBe("Checkout failed");

      checkoutState = {};
      view.rerender(<Harness advertisedPrice={signedPrice} />);
      expect(view.getByRole("alert").textContent).toBe("Email failed");
    });

    test("marks the price as loading only before a first price", () => {
      const view = render(
        <Harness advertisedPrice={{ ...signedPrice, isFetching: true }} />
      );
      expect(getSubmitButton(view).dataset.reservationPriceLoading).toBe(
        "false"
      );

      view.rerender(
        <Harness
          advertisedPrice={{
            isError: false,
            isFetching: true,
            token: undefined,
          }}
        />
      );
      expect(getSubmitButton(view).dataset.reservationPriceLoading).toBe(
        "true"
      );
    });
  });

  test("shows the Pay page's skeleton while checkout is prepared", () => {
    checkoutState = { isPreparingCheckout: true };
    const view = render(<Harness advertisedPrice={signedPrice} />);

    expect(view.container.querySelector("form")).toBeNull();
    expect(view.container.innerHTML).not.toBe("");
  });
});
