import { beforeAll, describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { NexiService } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import {
  buildSignedPayState,
  sealPayState,
} from "@/features/checkout/backend/pay-state";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import { checkoutDetailsJsonSchema } from "@/features/checkout/schemas/checkout-details";

mock.module("server-only", () => ({}));

type PaymentOrderRepositoryShape = {
  readonly create: ReturnType<typeof mock>;
  readonly findById: ReturnType<typeof mock>;
  readonly attachNexiSession: ReturnType<typeof mock>;
  readonly claimNexiSessionCreation: ReturnType<typeof mock>;
  readonly markPaymentPending: ReturnType<typeof mock>;
  readonly markFailed: ReturnType<typeof mock>;
  readonly resetUnsuccessfulForRetry: ReturnType<typeof mock>;
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

const key = Buffer.alloc(32, 7).toString("base64url");

const makePayStateToken = (
  quote = buildWorkspaceCheckoutQuote(reservation),
  orderId = "checkout-service-test-order"
) =>
  sealPayState(
    buildSignedPayState({
      locale: "en-US",
      reservation,
      quote,
      orderId,
    })
  );

const makePaymentOrder = (overrides: Record<string, unknown> = {}) => ({
  ...(() => {
    const quote = buildWorkspaceCheckoutQuote(reservation);
    return {
      checkoutDetails: {
        payment: {
          expectedPrice: quote.summary.total,
          quoteFingerprint: quote.fingerprint,
          summary: quote.summary,
        },
      } as never,
    };
  })(),
  id: "checkout-service-test-order",
  provider: "nexi" as const,
  dotyposCustomerId: "customer",
  correlationId: "correlation",
  dotyposReservationId: null,
  securityToken: null,
  paymentStatus: "created" as const,
  fulfillmentStatus: "not_started" as const,
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  paidAt: null,
  reservationCreatedAt: null,
  customerAccessEmailSentAt: null,
  internalNotificationSentAt: null,
  fulfilledAt: null,
  fulfillmentFailedAt: null,
  fulfillmentFailureCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makePaymentOrderRepository = (
  overrides: Partial<PaymentOrderRepositoryShape> = {}
): PaymentOrderRepositoryShape => ({
  create: mock((input) => {
    const checkoutDetails = checkoutDetailsJsonSchema.parse({
      ...input.checkoutDetails,
      fulfillment: { accessCodePolicy: "workspace-static-v1" },
    });

    return Effect.succeed(makePaymentOrder({ id: input.id, checkoutDetails }));
  }),
  findById: mock(() => Effect.succeed(null)),
  attachNexiSession: mock(() => Effect.void),
  claimNexiSessionCreation: mock(() => Effect.succeed(true)),
  markPaymentPending: mock(() => Effect.void),
  markFailed: mock(() => Effect.void),
  resetUnsuccessfulForRetry: mock((input) =>
    Effect.succeed(
      makePaymentOrder({
        id: input.id,
        correlationId: input.correlationId,
        checkoutDetails: checkoutDetailsJsonSchema.parse({
          ...input.checkoutDetails,
          fulfillment: { accessCodePolicy: "workspace-static-v1" },
        }),
      })
    )
  ),
  ...overrides,
});

const setRequiredEnv = () => {
  process.env.CHECKOUT_PAY_STATE_KEYS = `test:${key}`;
  process.env.CLOUDINARY_API_KEY = "test";
  process.env.CLOUDINARY_API_SECRET = "test";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
  process.env.DOTYPOS_API_URL = "https://dotypos.example";
  process.env.DOTYPOS_BRANCH_ID = "branch";
  process.env.DOTYPOS_CLIENT_ID = "client";
  process.env.DOTYPOS_CLIENT_SECRET = "secret";
  process.env.DOTYPOS_CLOUD_ID = "cloud";
  process.env.DOTYPOS_EMPLOYEE_ID = "employee";
  process.env.DOTYPOS_REFRESH_TOKEN = "refresh";
  process.env.NEXI_API_KEY = "nexi";
  process.env.NEXI_API_ORIGIN = "https://xpaysandbox.nexigroup.com";
  process.env.VERCEL_ENV = "development";
  process.env.VERCEL_URL = "deskohub.test";
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "cloud";
};

const loadBackend = async () => {
  const checkout = await import("@/features/checkout/backend/checkout.service");
  const paymentOrders = await import(
    "@/features/checkout/backend/payment-order.repository"
  );
  const returnTokens = await import(
    "@/features/checkout/backend/checkout-return-state-token.repository"
  );
  const workspaceQuote = await import(
    "@/features/checkout/backend/workspace-checkout-quote.server"
  );

  return { checkout, paymentOrders, returnTokens, workspaceQuote };
};

const makeLayer = async (input: {
  readonly dotypos?: Record<string, unknown>;
  readonly nexi?: Record<string, unknown>;
  readonly paymentOrders?: PaymentOrderRepositoryShape;
  readonly returnTokens?: Record<string, unknown>;
}) => {
  const backend = await loadBackend();

  return Layer.mergeAll(
    Layer.succeed(DotyposService, {
      findCustomer: mock(() =>
        Effect.succeed({ _tag: "NotFound", matches: [] })
      ),
      findOrCreateCustomer: mock(() => Effect.succeed({ id: "customer" })),
      getCustomerDiscount: mock(() => Effect.succeed(undefined)),
      ...input.dotypos,
    } as never),
    Layer.succeed(NexiService, {
      createHostedPaymentPage: mock(() =>
        Effect.succeed({
          orderId: "checkout-service-test-order",
          hostedPage: "https://nexi.example/hosted",
          securityToken: "token",
        })
      ),
      verifyPaymentOutcome: mock(() => Effect.succeed({ status: "pending" })),
      ...input.nexi,
    } as never),
    Layer.succeed(
      backend.paymentOrders.PaymentOrderRepository,
      input.paymentOrders ?? makePaymentOrderRepository()
    ),
    Layer.succeed(backend.returnTokens.CheckoutReturnStateTokenRepository, {
      create: mock(() => Effect.succeed("a".repeat(43))),
      ...input.returnTokens,
    } as never)
  );
};

const runCheckout = async (
  input: {
    readonly payStateToken: string;
    readonly legalConsent?: boolean;
  },
  layer: Layer.Layer<never, never, never>
) => {
  const backend = await loadBackend();

  return Effect.gen(function* () {
    const service = yield* backend.checkout.CheckoutService;
    return yield* service.createHostedPaymentCheckout(input, "en-US");
  }).pipe(
    Effect.provide(backend.checkout.CheckoutServiceLive),
    Effect.provide(layer),
    Effect.runPromise
  );
};

describe("CheckoutService final submit enforcement", () => {
  beforeAll(setRequiredEnv);

  test("rejects false consent before Dotypos lookup or payment order insert", async () => {
    const findCustomer = mock(() =>
      Effect.succeed({ _tag: "NotFound", matches: [] })
    );
    const paymentOrders = makePaymentOrderRepository();

    await expect(
      runCheckout(
        { payStateToken: "not-opened", legalConsent: false },
        await makeLayer({ dotypos: { findCustomer }, paymentOrders })
      )
    ).rejects.toThrow("Legal consent is required");

    expect(findCustomer).not.toHaveBeenCalled();
    expect(paymentOrders.create).not.toHaveBeenCalled();
  });

  test("rejects tampered Pay state before payment order insert", async () => {
    const paymentOrders = makePaymentOrderRepository();

    await expect(
      runCheckout(
        { payStateToken: `${makePayStateToken()}x`, legalConsent: true },
        await makeLayer({ paymentOrders })
      )
    ).rejects.toThrow("Pay state is invalid or expired");

    expect(paymentOrders.create).not.toHaveBeenCalled();
  });

  test("returns pricing_changed before mutable side effects when discount drifts", async () => {
    const findOrCreateCustomer = mock(() => Effect.succeed({ id: "customer" }));
    const paymentOrders = makePaymentOrderRepository();
    const result = await runCheckout(
      { payStateToken: makePayStateToken(), legalConsent: true },
      await makeLayer({
        paymentOrders,
        dotypos: {
          findCustomer: mock(() =>
            Effect.succeed({
              _tag: "Matched",
              customer: { id: "customer" },
              matches: [{ id: "customer" }],
            })
          ),
          getCustomerDiscount: mock(() =>
            Effect.succeed({
              source: "dotypos-discount-group" as const,
              field: "_discountGroupId",
              discountGroupId: "vip",
              percent: 10,
            })
          ),
          findOrCreateCustomer,
        },
      })
    );

    expect(result.status).toBe("pricing_changed");
    expect(
      result.status === "pricing_changed" && result.changedKeys.itemKeys
    ).toContain("discount/customer-discount:dotypos-discount-group:vip");
    expect(findOrCreateCustomer).not.toHaveBeenCalled();
    expect(paymentOrders.create).not.toHaveBeenCalled();
  });

  test("replays stored redirect for duplicate orderId without Dotypos mutation", async () => {
    const findCustomer = mock(() =>
      Effect.succeed({ _tag: "NotFound", matches: [] })
    );
    const findOrCreateCustomer = mock(() => Effect.succeed({ id: "customer" }));
    const paymentOrders = makePaymentOrderRepository({
      findById: mock(() =>
        Effect.succeed(
          makePaymentOrder({
            securityToken: "token",
            checkoutDetails: {
              payment: {
                expectedPrice:
                  buildWorkspaceCheckoutQuote(reservation).summary.total,
                providerRedirectUrl: "https://nexi.example/hosted",
              },
            },
            paymentStatus: "payment_pending" as const,
          })
        )
      ),
    });

    const result = await runCheckout(
      { payStateToken: makePayStateToken(), legalConsent: true },
      await makeLayer({
        paymentOrders,
        dotypos: { findCustomer, findOrCreateCustomer },
      })
    );

    expect(result).toEqual({
      status: "redirect",
      redirectUrl: "https://nexi.example/hosted",
    });
    expect(findCustomer).not.toHaveBeenCalled();
    expect(findOrCreateCustomer).not.toHaveBeenCalled();
    expect(paymentOrders.create).not.toHaveBeenCalled();
  });

  test("retries terminal order with the same orderId", async () => {
    const findCustomer = mock(() =>
      Effect.succeed({ _tag: "NotFound", matches: [] })
    );
    const findOrCreateCustomer = mock(() => Effect.succeed({ id: "customer" }));
    const createHostedPaymentPage = mock(() =>
      Effect.succeed({
        orderId: "checkout-service-test-order",
        hostedPage: "https://nexi.example/new-hosted",
        securityToken: "new-token",
      })
    );
    const paymentOrders = makePaymentOrderRepository({
      findById: mock(() =>
        Effect.succeed(
          makePaymentOrder({
            securityToken: "token",
            checkoutDetails: {
              payment: {
                expectedPrice:
                  buildWorkspaceCheckoutQuote(reservation).summary.total,
                providerRedirectUrl: "https://nexi.example/stale-hosted",
              },
            },
            paymentStatus: "cancelled" as const,
          })
        )
      ),
    });

    const result = await runCheckout(
      { payStateToken: makePayStateToken(), legalConsent: true },
      await makeLayer({
        paymentOrders,
        dotypos: { findCustomer, findOrCreateCustomer },
        nexi: { createHostedPaymentPage },
      })
    );

    expect(result).toEqual({
      status: "redirect",
      redirectUrl: "https://nexi.example/new-hosted",
    });
    expect(findCustomer).toHaveBeenCalled();
    expect(findOrCreateCustomer).not.toHaveBeenCalled();
    expect(paymentOrders.create).not.toHaveBeenCalled();
    expect(paymentOrders.resetUnsuccessfulForRetry).toHaveBeenCalledWith(
      expect.objectContaining({ id: "checkout-service-test-order" })
    );
    expect(paymentOrders.claimNexiSessionCreation).toHaveBeenCalledTimes(1);
    expect(createHostedPaymentPage).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "checkout-service-test-order" })
    );
    expect(paymentOrders.attachNexiSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "checkout-service-test-order" })
    );
    expect(paymentOrders.markPaymentPending).toHaveBeenCalledWith(
      "checkout-service-test-order"
    );
  });

  test("rejects ambiguous Dotypos lookup before mutable side effects", async () => {
    const findOrCreateCustomer = mock(() => Effect.succeed({ id: "customer" }));
    const paymentOrders = makePaymentOrderRepository();

    await expect(
      runCheckout(
        { payStateToken: makePayStateToken(), legalConsent: true },
        await makeLayer({
          paymentOrders,
          dotypos: {
            findCustomer: mock(() =>
              Effect.succeed({
                _tag: "Ambiguous",
                matches: [{ id: "a" }, { id: "b" }],
              })
            ),
            findOrCreateCustomer,
          },
        })
      )
    ).rejects.toThrow("Customer discount could not be confirmed");

    expect(findOrCreateCustomer).not.toHaveBeenCalled();
    expect(paymentOrders.create).not.toHaveBeenCalled();
  });

  test("rejects ambiguous Dotypos lookup before resuming a created order", async () => {
    const createHostedPaymentPage = mock(() =>
      Effect.succeed({
        orderId: "checkout-service-test-order",
        hostedPage: "https://nexi.example/hosted",
        securityToken: "token",
      })
    );
    const paymentOrders = makePaymentOrderRepository({
      findById: mock(() => Effect.succeed(makePaymentOrder())),
    });

    await expect(
      runCheckout(
        { payStateToken: makePayStateToken(), legalConsent: true },
        await makeLayer({
          paymentOrders,
          nexi: { createHostedPaymentPage },
          dotypos: {
            findCustomer: mock(() =>
              Effect.succeed({
                _tag: "Ambiguous",
                matches: [{ id: "a" }, { id: "b" }],
              })
            ),
          },
        })
      )
    ).rejects.toThrow("Customer discount could not be confirmed");

    expect(paymentOrders.claimNexiSessionCreation).not.toHaveBeenCalled();
    expect(createHostedPaymentPage).not.toHaveBeenCalled();
    expect(paymentOrders.attachNexiSession).not.toHaveBeenCalled();
  });

  test("returns pricing_changed before resuming a created order when fresh quote drifts", async () => {
    const createHostedPaymentPage = mock(() =>
      Effect.succeed({
        orderId: "checkout-service-test-order",
        hostedPage: "https://nexi.example/hosted",
        securityToken: "token",
      })
    );
    const paymentOrders = makePaymentOrderRepository({
      findById: mock(() => Effect.succeed(makePaymentOrder())),
    });

    const result = await runCheckout(
      { payStateToken: makePayStateToken(), legalConsent: true },
      await makeLayer({
        paymentOrders,
        nexi: { createHostedPaymentPage },
        dotypos: {
          findCustomer: mock(() =>
            Effect.succeed({
              _tag: "Matched",
              customer: { id: "customer" },
              matches: [{ id: "customer" }],
            })
          ),
          getCustomerDiscount: mock(() =>
            Effect.succeed({
              source: "dotypos-discount-group" as const,
              field: "_discountGroupId",
              discountGroupId: "vip",
              percent: 10,
            })
          ),
        },
      })
    );

    expect(result.status).toBe("pricing_changed");
    expect(
      result.status === "pricing_changed" && result.changedKeys.itemKeys
    ).toContain("discount/customer-discount:dotypos-discount-group:vip");
    expect(paymentOrders.claimNexiSessionCreation).not.toHaveBeenCalled();
    expect(createHostedPaymentPage).not.toHaveBeenCalled();
    expect(paymentOrders.attachNexiSession).not.toHaveBeenCalled();
  });

  test("quote preview also fails closed on ambiguous Dotypos lookup", async () => {
    const backend = await loadBackend();

    await expect(
      backend.workspaceQuote
        .buildAuthoritativeWorkspaceCheckoutQuoteEffect(reservation)
        .pipe(
          Effect.provide(
            Layer.succeed(DotyposService, {
              findCustomer: mock(() =>
                Effect.succeed({
                  _tag: "Ambiguous",
                  matches: [{ id: "a" }, { id: "b" }],
                })
              ),
              getCustomerDiscount: mock(() => Effect.succeed(undefined)),
            } as never)
          ),
          Effect.runPromise
        )
    ).rejects.toThrow("Customer discount could not be confirmed");
  });

  test("does not create a hosted payment page when session creation is already claimed", async () => {
    const createHostedPaymentPage = mock(() =>
      Effect.succeed({
        orderId: "checkout-service-test-order",
        hostedPage: "https://nexi.example/hosted",
        securityToken: "token",
      })
    );
    const paymentOrders = makePaymentOrderRepository({
      claimNexiSessionCreation: mock(() => Effect.succeed(false)),
    });

    const result = await runCheckout(
      { payStateToken: makePayStateToken(), legalConsent: true },
      await makeLayer({
        paymentOrders,
        nexi: { createHostedPaymentPage },
      })
    );

    expect(result).toEqual({ status: "in_progress" });
    expect(createHostedPaymentPage).not.toHaveBeenCalled();
    expect(paymentOrders.attachNexiSession).not.toHaveBeenCalled();
  });

  test("marks the order failed when Nexi HPP creation fails after claiming session creation", async () => {
    const createHostedPaymentPage = mock(() =>
      Effect.fail(new Error("Nexi unavailable"))
    );
    const paymentOrders = makePaymentOrderRepository();

    await expect(
      runCheckout(
        { payStateToken: makePayStateToken(), legalConsent: true },
        await makeLayer({
          paymentOrders,
          nexi: { createHostedPaymentPage },
        })
      )
    ).rejects.toThrow("Payment checkout could not be started");

    expect(paymentOrders.claimNexiSessionCreation).toHaveBeenCalledTimes(1);
    expect(createHostedPaymentPage).toHaveBeenCalledTimes(1);
    expect(paymentOrders.markFailed).toHaveBeenCalledWith({
      id: "checkout-service-test-order",
      failureCode: "nexi_hpp_create_failed",
      providerStatus: "hpp_create_failed",
    });
    expect(paymentOrders.attachNexiSession).not.toHaveBeenCalled();
    expect(paymentOrders.markPaymentPending).not.toHaveBeenCalled();
  });

  test("replays stored redirect when session creation claim loses to a completed submit", async () => {
    const createHostedPaymentPage = mock(() =>
      Effect.succeed({
        orderId: "checkout-service-test-order",
        hostedPage: "https://nexi.example/new-hosted",
        securityToken: "new-token",
      })
    );
    const paymentOrders = makePaymentOrderRepository({
      claimNexiSessionCreation: mock(() => Effect.succeed(false)),
      findById: mock(() =>
        Effect.succeed(
          makePaymentOrder({
            securityToken: "token",
            paymentStatus: "payment_pending" as const,
            checkoutDetails: {
              payment: {
                expectedPrice:
                  buildWorkspaceCheckoutQuote(reservation).summary.total,
                providerRedirectUrl: "https://nexi.example/hosted",
              },
            },
          })
        )
      ),
    });

    const result = await runCheckout(
      { payStateToken: makePayStateToken(), legalConsent: true },
      await makeLayer({
        paymentOrders,
        nexi: { createHostedPaymentPage },
      })
    );

    expect(result).toEqual({
      status: "redirect",
      redirectUrl: "https://nexi.example/hosted",
    });
    expect(createHostedPaymentPage).not.toHaveBeenCalled();
    expect(paymentOrders.attachNexiSession).not.toHaveBeenCalled();
  });

  test("does not replay stored redirect when session creation claim finds terminal order", async () => {
    let findByIdCalls = 0;
    const createHostedPaymentPage = mock(() =>
      Effect.succeed({
        orderId: "checkout-service-test-order",
        hostedPage: "https://nexi.example/new-hosted",
        securityToken: "new-token",
      })
    );
    const paymentOrders = makePaymentOrderRepository({
      claimNexiSessionCreation: mock(() => Effect.succeed(false)),
      findById: mock((id) => {
        findByIdCalls += 1;

        return findByIdCalls === 1
          ? Effect.succeed(null)
          : Effect.succeed(
              makePaymentOrder({
                id,
                securityToken: "token",
                paymentStatus: "payment_failed" as const,
                checkoutDetails: {
                  payment: {
                    expectedPrice:
                      buildWorkspaceCheckoutQuote(reservation).summary.total,
                    providerRedirectUrl: "https://nexi.example/stale-hosted",
                  },
                },
              })
            );
      }),
      create: mock((input) =>
        Effect.succeed(
          makePaymentOrder({
            id: input.id,
            checkoutDetails: input.checkoutDetails,
          })
        )
      ),
    });

    const result = await runCheckout(
      {
        payStateToken: makePayStateToken(undefined, "fresh-order-id"),
        legalConsent: true,
      },
      await makeLayer({
        paymentOrders,
        nexi: { createHostedPaymentPage },
      })
    );

    expect(result).toEqual({ status: "in_progress" });
    expect(createHostedPaymentPage).not.toHaveBeenCalled();
    expect(paymentOrders.attachNexiSession).not.toHaveBeenCalled();
    expect(paymentOrders.markPaymentPending).not.toHaveBeenCalled();
  });

  test("builds parseable payment order checkout details without message or contact fields", async () => {
    const paymentOrders = makePaymentOrderRepository();

    await runCheckout(
      { payStateToken: makePayStateToken(), legalConsent: true },
      await makeLayer({ paymentOrders })
    );

    expect(paymentOrders.create).toHaveBeenCalledTimes(1);
    const checkoutDetails =
      paymentOrders.create.mock.calls[0]?.[0].checkoutDetails;

    expect(
      checkoutDetailsJsonSchema.parse({
        ...checkoutDetails,
        fulfillment: { accessCodePolicy: "workspace-static-v1" },
      })
    ).toEqual(
      expect.objectContaining({
        schema: "workspace-checkout-details",
        schemaVersion: 1,
      })
    );
    expect(checkoutDetails.reservation).toEqual({
      tier: "basic",
      date: "2099-06-10",
      coffee: false,
      monitorOption: undefined,
    });
    expect(JSON.stringify(checkoutDetails)).not.toContain("Ada Lovelace");
    expect(JSON.stringify(checkoutDetails)).not.toContain("ada@example.com");
    expect(JSON.stringify(checkoutDetails)).not.toContain("+420777123456");
    expect(JSON.stringify(checkoutDetails)).not.toContain("hello");
  });
});
