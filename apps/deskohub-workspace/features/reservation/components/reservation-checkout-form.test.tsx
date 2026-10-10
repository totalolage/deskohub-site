import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ReservationExistingCustomerForm } from "../reservation-existing-customer";

const startCheckout = mock();

mock.module("./use-reservation-checkout", () => ({
  useReservationCheckout: () => ({
    capturePrePaymentOutcome: mock(),
    clearSubmissionError: mock(),
    hasPreparedPayRedirect: false,
    isPreparingCheckout: false,
    isSubmittingCheckout: false,
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

function Harness({
  advertisedPrice,
  existingCustomer,
}: {
  readonly advertisedPrice: {
    readonly isError: boolean;
    readonly token?: string;
  };
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
        ...advertisedPrice,
        isFetching: false,
        retry: () => undefined,
      }}
      availability={{ isFetching: false }}
      existingCustomer={existingCustomer}
      form={form}
      getReservation={({ email, name, phone }) =>
        ({ email, name, phone }) as never
      }
      locale="en-US"
    >
      {null}
    </ReservationCheckoutForm>
  );
}

const getSubmitButton = (view: ReturnType<typeof render>) =>
  view.container.querySelector("#reservation-submit") as HTMLButtonElement;

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

  test("allows submission with a current advertised price", () => {
    const view = render(
      <Harness advertisedPrice={{ isError: false, token: "signed-price" }} />
    );

    expect(getSubmitButton(view).disabled).toBe(false);
  });

  test("blocks submission when the advertised price refresh failed", () => {
    // A failed background refresh keeps the previous, possibly expired,
    // signed price; submitting it would only fail on the server.
    const view = render(
      <Harness advertisedPrice={{ isError: true, token: "stale-price" }} />
    );

    expect(getSubmitButton(view).disabled).toBe(true);
  });

  test("books as the account only while the account card is shown", async () => {
    const existingCustomer: ReservationExistingCustomerForm = {
      contact: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+420777777777",
      },
      initialMode: "account",
      otherContact: {
        name: "Grace Hopper",
        email: "grace@example.com",
        phone: "+420606060606",
      },
    };
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
      reservation: { email: "ada@example.com", name: "Ada Lovelace" },
    });

    fireEvent.click(
      view.getByRole("button", { name: "Book for someone else" })
    );
    fireEvent.click(getSubmitButton(view));
    await waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(2));
    expect(startCheckout.mock.calls[1]?.[0]).not.toHaveProperty("customer");
    expect(startCheckout.mock.calls[1]?.[0]).toMatchObject({
      reservation: existingCustomer.otherContact,
    });
  });
});
