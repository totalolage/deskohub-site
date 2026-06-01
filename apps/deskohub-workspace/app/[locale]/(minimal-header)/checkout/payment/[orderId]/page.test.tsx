import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";

mock.module("server-only", () => ({}));

const notFound = mock(() => {
  throw new Error("NEXT_NOT_FOUND");
});

mock.module("next/navigation", () => ({ notFound }));

const CheckoutReturnStateTokenRepository =
  Context.GenericTag<CheckoutReturnStateTokenRepositoryShape>(
    "CheckoutReturnStateTokenRepository"
  );
const CheckoutStatusService = Context.GenericTag<CheckoutStatusServiceShape>(
  "CheckoutStatusService"
);

let readValid = mock<CheckoutReturnStateTokenRepositoryShape["readValid"]>();
let getStatus = mock<CheckoutStatusServiceShape["getStatus"]>();
let recordProviderReturn =
  mock<CheckoutStatusServiceShape["recordProviderReturn"]>();

mock.module(
  "@/features/checkout/backend/checkout-return-state-token.repository",
  () => ({
    CheckoutReturnStateTokenRepository,
    CheckoutReturnStateTokenRepositoryLive: Layer.succeed(
      CheckoutReturnStateTokenRepository,
      {
        readValid: (input) => readValid(input),
      }
    ),
  })
);

mock.module("@/features/checkout/backend/checkout-status.service", () => ({
  CheckoutStatusService,
  CheckoutStatusServiceLiveWithDependencies: Layer.succeed(
    CheckoutStatusService,
    {
      getStatus: (input) => getStatus(input),
      recordProviderReturn: (input) => recordProviderReturn(input),
    }
  ),
}));

mock.module(
  "@/features/checkout/backend/workspace-checkout-quote.server",
  () => ({
    buildAuthoritativeWorkspaceCheckoutQuote: () =>
      Promise.resolve(buildWorkspaceCheckoutQuote(reservation)),
  })
);

mock.module("@/features/checkout/components/checkout-flow-layout", () => ({
  CheckoutFlowLayout: (props: unknown) => props,
}));

mock.module("@/features/checkout/components/checkout-pay-page", () => ({
  CheckoutPayPage: (props: unknown) => props,
}));

mock.module("@/db/database.service", () => ({
  WorkspaceDatabaseLive: Layer.empty,
}));

type CheckoutReturnStateTokenRepositoryShape = {
  readonly readValid: (input: {
    readonly paymentOrderId: string;
    readonly token: string;
  }) => Effect.Effect<{ readonly state: unknown }, Error>;
};

type CheckoutStatusServiceShape = {
  readonly getStatus: (input: {
    readonly orderId: string;
    readonly returnOutcome: "success" | "cancelled" | "unknown";
  }) => Effect.Effect<CheckoutStatusViewModel>;
  readonly recordProviderReturn: (input: {
    readonly orderId: string;
    readonly returnOutcome: "success" | "cancelled" | "unknown";
  }) => Effect.Effect<CheckoutStatusViewModel>;
};

type CheckoutStatusViewModel = {
  readonly orderId: string;
  readonly returnOutcome: "success" | "cancelled" | "unknown";
  readonly status:
    | "not_found"
    | "created"
    | "pending"
    | "paid_waiting_fulfillment"
    | "fulfilled"
    | "fulfillment_failed"
    | "payment_failed"
    | "cancelled"
    | "expired";
};

const reservation = {
  entryTier: "basic" as const,
  date: "2099-06-10",
  coffee: false,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777123456",
  message: "hello",
};

const returnState = {
  schema: "workspace-checkout-return-state" as const,
  schemaVersion: 1 as const,
  reservation,
};

const checkoutToken = "a".repeat(43);

const makeCheckoutStatus = (
  status: CheckoutStatusViewModel["status"],
  returnOutcome: CheckoutStatusViewModel["returnOutcome"] = "unknown",
  orderId = "original-order"
): CheckoutStatusViewModel => ({ orderId, returnOutcome, status });

const makeSearchParams = (
  token = checkoutToken,
  outcome: string | undefined = undefined
) => Promise.resolve({ checkoutToken: token, outcome });

const renderPaymentRetryPage = async (input: {
  readonly orderId?: string;
  readonly token?: string;
  readonly outcome?: string;
}) => {
  const page = await import("./page");

  return page.default({
    params: Promise.resolve({
      locale: "en-US",
      orderId: input.orderId ?? "original-order",
    }),
    searchParams: makeSearchParams(input.token, input.outcome),
  });
};

const getCheckoutPayPageProps = (element: unknown) => {
  const layout = element as {
    readonly props: { readonly children: { readonly props: unknown } };
  };

  return layout.props.children.props as {
    readonly orderId: string;
    readonly payStateToken: string;
    readonly variant: string;
  };
};

describe("checkout payment retry page", () => {
  beforeAll(() => {
    process.env.CHECKOUT_PAY_STATE_KEYS = `test:${Buffer.alloc(32, 7).toString(
      "base64url"
    )}`;
  });

  beforeEach(() => {
    notFound.mockClear();
    readValid = mock(() => Effect.succeed({ state: returnState }));
    getStatus = mock((input) =>
      Effect.succeed(makeCheckoutStatus("cancelled", input.returnOutcome))
    );
    recordProviderReturn = mock((input) =>
      Effect.succeed(makeCheckoutStatus("cancelled", input.returnOutcome))
    );
  });

  test("rejects a valid token for a paid original order", async () => {
    getStatus = mock((input) =>
      Effect.succeed(
        makeCheckoutStatus("paid_waiting_fulfillment", input.returnOutcome)
      )
    );

    await expect(renderPaymentRetryPage({})).rejects.toThrow("NEXT_NOT_FOUND");

    expect(readValid).toHaveBeenCalledWith({
      paymentOrderId: "original-order",
      token: checkoutToken,
    });
    expect(getStatus).toHaveBeenCalledWith({
      orderId: "original-order",
      returnOutcome: "unknown",
    });
    expect(recordProviderReturn).not.toHaveBeenCalled();
    expect(notFound).toHaveBeenCalled();
  });

  test("renders a fresh retry Pay state repeatedly for retryable original orders", async () => {
    for (const status of ["cancelled", "payment_failed", "expired"] as const) {
      readValid.mockClear();
      getStatus = mock((input) =>
        Effect.succeed(makeCheckoutStatus(status, input.returnOutcome))
      );

      const first = getCheckoutPayPageProps(await renderPaymentRetryPage({}));
      const second = getCheckoutPayPageProps(await renderPaymentRetryPage({}));

      expect(first).toEqual(
        expect.objectContaining({
          orderId: "original-order",
          variant: "retry",
        })
      );
      expect(second).toEqual(
        expect.objectContaining({
          orderId: "original-order",
          variant: "retry",
        })
      );
      expect(first.payStateToken).not.toBe(second.payStateToken);
      expect(readValid).toHaveBeenCalledTimes(2);
      expect(getStatus).toHaveBeenCalledTimes(2);
    }

    expect(notFound).not.toHaveBeenCalled();
  });

  test("rejects a pending original order with only a cancelled query", async () => {
    recordProviderReturn = mock((input) =>
      Effect.succeed(makeCheckoutStatus("pending", input.returnOutcome))
    );

    await expect(
      renderPaymentRetryPage({ outcome: "cancelled" })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(recordProviderReturn).toHaveBeenCalledWith({
      orderId: "original-order",
      returnOutcome: "cancelled",
    });
    expect(notFound).toHaveBeenCalled();
  });

  test("allows a cancelled return after provider status reconciliation", async () => {
    recordProviderReturn = mock((input) =>
      Effect.succeed(makeCheckoutStatus("cancelled", input.returnOutcome))
    );

    const retry = getCheckoutPayPageProps(
      await renderPaymentRetryPage({ outcome: "cancelled" })
    );

    expect(retry).toEqual(
      expect.objectContaining({
        orderId: "original-order",
        variant: "retry",
      })
    );
    expect(recordProviderReturn).toHaveBeenCalledWith({
      orderId: "original-order",
      returnOutcome: "cancelled",
    });
    expect(notFound).not.toHaveBeenCalled();
  });

  test("rejects paid or still-pending orders even with a cancelled query", async () => {
    for (const status of ["paid_waiting_fulfillment", "pending"] as const) {
      recordProviderReturn = mock((input) =>
        Effect.succeed(makeCheckoutStatus(status, input.returnOutcome))
      );

      await expect(
        renderPaymentRetryPage({ outcome: "cancelled" })
      ).rejects.toThrow("NEXT_NOT_FOUND");

      expect(notFound).toHaveBeenCalled();
      notFound.mockClear();
    }
  });

  test("rejects a pending original order without provider cancellation outcome", async () => {
    getStatus = mock((input) =>
      Effect.succeed(makeCheckoutStatus("pending", input.returnOutcome))
    );

    await expect(renderPaymentRetryPage({})).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalled();
  });

  test("rejects a token bound to a different payment order", async () => {
    readValid = mock((input) =>
      input.paymentOrderId === "original-order"
        ? Effect.fail(new Error("bound to another order"))
        : Effect.succeed({ state: returnState })
    );

    await expect(
      renderPaymentRetryPage({ orderId: "original-order" })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(readValid).toHaveBeenCalledWith({
      paymentOrderId: "original-order",
      token: checkoutToken,
    });
    expect(getStatus).not.toHaveBeenCalled();
    expect(recordProviderReturn).not.toHaveBeenCalled();
  });
});
