import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { Schema } from "effect";
import { type ComponentProps, useState } from "react";
import { useForm } from "react-hook-form";
import { discountIdSchema } from "@/features/discounts/contracts";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ReservationExistingCustomerForm } from "../reservation-existing-customer";

const adaEmail = testEmailAddress("ada");
const graceEmail = testEmailAddress("grace");

const startCheckout = mock();

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock() }),
}));

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

const { ReservationCheckoutForm } = await import("./reservation-checkout-form");

type HarnessValues = {
  readonly billing: {
    readonly purpose: "personal";
    readonly invoice: "none";
  };
  readonly email: string;
  readonly marketingConsent: boolean;
  readonly name: string;
  readonly phone: string;
};

type CheckoutFormProps = ComponentProps<typeof ReservationCheckoutForm>;

function Harness({
  advertisedPrice,
  availability = { isPending: false },
  existingCustomer,
}: {
  readonly advertisedPrice: Pick<
    CheckoutFormProps["advertisedPrice"],
    "isError" | "token" | "sale"
  > &
    Partial<Pick<CheckoutFormProps["advertisedPrice"], "isFetching" | "retry">>;
  readonly availability?: CheckoutFormProps["availability"];
  readonly existingCustomer?: ReservationExistingCustomerForm;
}) {
  const form = useForm<HarnessValues>({
    defaultValues: {
      billing: { purpose: "personal", invoice: "none" },
      email: existingCustomer?.contact.email ?? "",
      marketingConsent: false,
      name: existingCustomer?.contact.name ?? "",
      phone: existingCustomer?.contact.phone ?? "",
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
      existingCustomer={existingCustomer}
      form={form}
      getReservation={({ email, name, phone }) =>
        ({ email, name, phone }) as never
      }
      locale="en-US"
      selection={{ kind: "cowork", fromSearchParams: () => ({}) }}
    >
      {null}
    </ReservationCheckoutForm>
  );
}

const getSubmitButton = (view: ReturnType<typeof render>) =>
  view.container.querySelector("#reservation-submit") as HTMLButtonElement;

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

const getMarketingConsentCheckbox = (view: ReturnType<typeof render>) =>
  view.container.querySelector("#reservation-marketing-consent");

describe("ReservationCheckoutForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    startCheckout.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("re-enables submission once a failed advertised price is retried", async () => {
    const view = render(<RetryablePriceHarness />);

    expect(view.getByRole("alert").textContent).toContain(
      m.reservationAdvertisedPriceError({}, { locale: "en-US" })
    );
    expect(getSubmitButton(view).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.reservationAdvertisedPriceRetry({}, { locale: "en-US" }),
        })
      );
    });

    expect(view.queryByRole("alert")).toBeNull();
    expect(getSubmitButton(view).disabled).toBe(false);
  });

  test("blocks submission and explains why when availability could not be confirmed", () => {
    const availabilityError = m.reservationAvailabilityError(
      {},
      { locale: "en-US" }
    );
    const view = render(
      <Harness
        advertisedPrice={{ isError: false, token: "signed-price" }}
        availability={{
          isPending: false,
          unavailableMessage: availabilityError,
        }}
      />
    );

    expect(view.getByText(availabilityError)).toBeDefined();
    expect(getSubmitButton(view).disabled).toBe(true);
    expect(
      getSubmitButton(view).getAttribute("data-reservation-unavailable")
    ).toBe("true");
  });

  test("presents an advertised sale once around the whole form", () => {
    const view = render(
      <Harness
        advertisedPrice={{
          isError: false,
          sale: familySale,
          token: "signed-price",
        }}
      />
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
      saleDiscount?.querySelector("[data-reservation-sale-discount-value]")
        ?.textContent
    ).toBe("-50%");
    expect(
      view.getByRole("button", {
        name: m.checkoutSummaryDiscountDetailsTrigger(
          { product: "Open Space" },
          { locale: "en-US" }
        ),
      })
    ).toBeDefined();
  });

  test("books as the account only while the account card is shown", async () => {
    const view = render(
      <Harness
        advertisedPrice={{ isError: false, token: "signed-price" }}
        existingCustomer={existingCustomer}
      />
    );

    fireEvent.click(getSubmitButton(view));
    await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(1));
    expect(startCheckout.mock.calls[0]?.[0]).toMatchObject({
      customer: "account",
      reservation: { email: adaEmail, name: "Ada Lovelace" },
    });

    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationBookForSomeoneElse({}, { locale: "en-US" }),
      })
    );
    fireEvent.click(getSubmitButton(view));
    await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(2));
    expect(startCheckout.mock.calls[1]?.[0]).not.toHaveProperty("customer");
    expect(startCheckout.mock.calls[1]?.[0]).toMatchObject({
      reservation: existingCustomer.otherContact,
    });
  });

  test("asks an account without marketing consent to opt in", () => {
    const view = render(
      <Harness
        advertisedPrice={{ isError: false, token: "signed-price" }}
        existingCustomer={existingCustomer}
      />
    );

    expect(getMarketingConsentCheckbox(view)).not.toBeNull();
  });

  test("hides marketing consent for an account that already gave it", async () => {
    const view = render(
      <Harness
        advertisedPrice={{ isError: false, token: "signed-price" }}
        existingCustomer={{
          ...existingCustomer,
          hasMarketingConsent: true,
          initialMode: "contact",
        }}
      />
    );

    // Another contact is a different customer, so they are still asked.
    const checkbox = getMarketingConsentCheckbox(view);
    expect(checkbox).not.toBeNull();
    fireEvent.click(checkbox as Element);

    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationUseAccountDetails({}, { locale: "en-US" }),
      })
    );
    expect(getMarketingConsentCheckbox(view)).toBeNull();

    // The hidden checkbox submits no opt-in, which leaves the stored
    // consent as it is.
    fireEvent.click(getSubmitButton(view));
    await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(1));
    expect(startCheckout.mock.calls[0]?.[0]).toMatchObject({
      customer: "account",
      marketingConsent: false,
    });
  });
});
