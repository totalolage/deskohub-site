import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { useForm } from "react-hook-form";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("./use-reservation-checkout", () => ({
  useReservationCheckout: () => ({
    capturePrePaymentOutcome: mock(),
    clearSubmissionError: mock(),
    hasPreparedPayRedirect: false,
    isPreparingCheckout: false,
    isSubmittingCheckout: false,
    setSubmissionError: mock(),
    startCheckout: mock(),
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
}: {
  readonly advertisedPrice: {
    readonly isError: boolean;
    readonly token?: string;
  };
}) {
  const form = useForm<HarnessValues>({
    defaultValues: {
      billing: { purpose: "personal", invoice: "none" },
      email: "",
      marketingConsent: false,
      name: "",
      phone: "",
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
      form={form}
      getReservation={() => {
        throw new Error("submission is not exercised");
      }}
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

  afterEach(cleanup);

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
});
