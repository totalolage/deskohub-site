import "@/shared/testing/workspace-test-env";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { NexiService } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import {
  buildSignedPayState,
  openPayState,
  payStateTokenQueryParam,
  sealPayState,
} from "@/features/checkout/backend/pay-state";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import {
  checkoutDetailsJsonSchema,
  legalEvidenceMapSchema,
  paymentSubmitLegalEvidenceSource,
} from "@/features/checkout/schemas/checkout-details";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import type { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";

mock.module("server-only", () => ({}));

type PaymentOrderRepositoryShape = {
  readonly create: ReturnType<typeof mock>;
  readonly findById: ReturnType<typeof mock>;
  readonly mergeLegalEvidence: ReturnType<typeof mock>;
  readonly updateCheckoutDetails: ReturnType<typeof mock>;
  readonly attachNexiSession: ReturnType<typeof mock>;
  readonly claimNexiSessionCreation: ReturnType<typeof mock>;
  readonly markPaymentPending: ReturnType<typeof mock>;
  readonly markFailed: ReturnType<typeof mock>;
  readonly resetUnsuccessfulForRetry: ReturnType<typeof mock>;
  readonly claimReservationCreation: ReturnType<typeof mock>;
  readonly releaseReservationCreation: ReturnType<typeof mock>;
  readonly attachNewReservationHold: ReturnType<typeof mock>;
};

type DotyposCheckoutTestService = typeof DotyposService.Service;
type NexiCheckoutTestService = typeof NexiService.Service;
type AvailabilityCheckoutTestService = WorkspaceAvailabilityService;

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

const makeLegalEvidenceMap = () => {
  const terms = {
    path: "/terms-and-conditions",
    hash: "terms-hash",
    hashAlgorithm: "sha256",
  } as const;
  const rules = {
    path: "/operating-rules",
    hash: "rules-hash",
    hashAlgorithm: "sha256",
  } as const;
  const privacy = {
    path: "/privacy-policy",
    hash: "privacy-hash",
    hashAlgorithm: "sha256",
  } as const;
  const acceptedAt = new Date("2026-06-01T10:00:00.000Z").toISOString();

  return legalEvidenceMapSchema.parse({
    [terms.hash]: {
      documentKey: "termsAndConditions",
      documentHash: terms.hash,
      accepted: true,
      acceptedAt,
      locale: "en-US",
      source: paymentSubmitLegalEvidenceSource,
      document: terms,
      acknowledgements: { noRefundAfterPinDelivery: true },
    },
    [rules.hash]: {
      documentKey: "operatingRules",
      documentHash: rules.hash,
      accepted: true,
      acceptedAt,
      locale: "en-US",
      source: paymentSubmitLegalEvidenceSource,
      document: rules,
    },
    [privacy.hash]: {
      documentKey: "privacyPolicy",
      documentHash: privacy.hash,
      accepted: true,
      acceptedAt,
      locale: "en-US",
      source: paymentSubmitLegalEvidenceSource,
      document: privacy,
    },
  });
};

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
      checkoutDetails: checkoutDetailsJsonSchema.parse({
        schema: "workspace-checkout-details",
        schemaVersion: 1,
        locale: "en-US",
        reservation: {
          tier: reservation.entryTier,
          date: reservation.date,
          coffee: reservation.coffee,
        },
        payment: {
          expectedPrice: quote.summary.total,
          quoteFingerprint: quote.fingerprint,
          summary: quote.summary,
        },
        legal: makeLegalEvidenceMap(),
        fulfillment: { accessCodePolicy: "workspace-static-v1" },
      } satisfies CheckoutDetailsJson),
    };
  })(),
  id: "checkout-service-test-order",
  provider: "nexi" as const,
  dotyposCustomerId: "customer",
  correlationId: "correlation",
  dotyposReservationId: "reservation-new",
  dotyposReservationStatus: "NEW" as const,
  securityToken: null,
  paymentStatus: "created" as const,
  fulfillmentStatus: "not_started" as const,
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  paidAt: null,
  reservationCreatedAt: null,
  reservationHoldExpiresAt: new Date("2099-06-10T10:00:00.000Z"),
  reservationHoldExpiredAt: null,
  reservationConfirmedAt: null,
  reservationCancelledAt: null,
  reservationCancellationFailureCode: null,
  reservationCancellationFailureMessage: null,
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
  mergeLegalEvidence: mock(({ id }) => Effect.succeed(makePaymentOrder({ id }))),
  updateCheckoutDetails: mock((input) =>
    Effect.succeed(
      makePaymentOrder({
        id: input.id,
        checkoutDetails: checkoutDetailsJsonSchema.parse({
          ...input.checkoutDetails,
          fulfillment: { accessCodePolicy: "workspace-static-v1" },
        }),
      })
    )
  ),
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
  claimReservationCreation: mock(() => Effect.succeed(true)),
  releaseReservationCreation: mock(() => Effect.void),
  attachNewReservationHold: mock(() => Effect.void),
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
  const cleanup = await import(
    "@/features/checkout/backend/reservation-hold-cleanup.service"
  );
  const availability = await import(
    "@/features/reservation/backend/workspace-availability.service"
  );
  const workspaceQuote = await import(
    "@/features/checkout/backend/workspace-checkout-quote.server"
  );
  const tableAssignment = await import(
    "@/features/checkout/backend/workspace-table-assignment.service"
  );

  return {
    checkout,
    paymentOrders,
    returnTokens,
    cleanup,
    availability,
    workspaceQuote,
    tableAssignment,
  };
};

const makeLayer = async (input: {
  readonly dotypos?: Partial<DotyposCheckoutTestService>;
  readonly nexi?: Partial<NexiCheckoutTestService>;
  readonly availability?: Partial<AvailabilityCheckoutTestService>;
  readonly paymentOrders?: PaymentOrderRepositoryShape;
  readonly returnTokens?: Record<string, unknown>;
}) => {
  const backend = await loadBackend();
  const dotyposService: DotyposCheckoutTestService = {
    createReservation: mock(() => Effect.die("createReservation not mocked")),
    getReservation: mock(() => Effect.die("getReservation not mocked")),
    getCustomer: mock(() => Effect.die("getCustomer not mocked")),
    findCustomer: mock(() =>
      Effect.succeed({ _tag: "NotFound" as const, matches: [] })
    ),
    findOrCreateCustomer: mock(() => Effect.succeed({ id: "customer" })),
    getCustomerDiscount: mock(() => Effect.succeed(undefined)),
    getTables: mock(() => Effect.die("getTables not mocked")),
    listReservations: mock(() => Effect.die("listReservations not mocked")),
    getProducts: mock(() => Effect.die("getProducts not mocked")),
    getCategories: mock(() => Effect.die("getCategories not mocked")),
    ...input.dotypos,
  };
  const nexiService: NexiCheckoutTestService = {
    createHostedPaymentPage: mock(() =>
      Effect.succeed({
        orderId: "checkout-service-test-order",
        hostedPage: "https://nexi.example/hosted",
        securityToken: "token",
      })
    ),
    verifyPaymentOutcome: mock(() => Effect.succeed({ status: "pending" })),
    ...input.nexi,
  };
  const availabilityService: AvailabilityCheckoutTestService = {
    getAvailability: mock(() =>
      Effect.succeed({
        from: reservation.date,
        to: reservation.date,
        unavailableDates: [],
        unavailableTiers: [],
        unavailableMonitorOptions: [],
      })
    ),
    ensureAvailable: mock(() => Effect.void),
    ...input.availability,
  };

  return Layer.mergeAll(
    Layer.succeed(DotyposService, dotyposService),
    Layer.succeed(NexiService, nexiService),
    Layer.succeed(
      backend.availability.WorkspaceAvailabilityService,
      availabilityService
    ),
    Layer.succeed(backend.tableAssignment.WorkspaceTableAssignmentService, {
      assignTableId: mock(() => Effect.succeed("workspace-table-1")),
    }),
    Layer.succeed(backend.cleanup.ReservationHoldCleanupService, {
      cancelOrderHold: mock(() => Effect.void),
      sweepExpiredHolds: mock(() =>
        Effect.succeed({ cancelled: 0, failed: 0 })
      ),
    }),
    Layer.succeed(
      backend.paymentOrders.PaymentOrderRepository,
      input.paymentOrders ?? makePaymentOrderRepository()
    ),
    Layer.succeed(backend.returnTokens.CheckoutReturnStateTokenRepository, {
      create: mock(() => Effect.succeed("a".repeat(43))),
      ...input.returnTokens,
    })
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

    expect(result).toEqual({ status: "in_progress" });
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
    expect(findCustomer).toHaveBeenCalledTimes(1);
    expect(findOrCreateCustomer).not.toHaveBeenCalled();
    expect(paymentOrders.create).not.toHaveBeenCalled();
    expect(paymentOrders.resetUnsuccessfulForRetry).toHaveBeenCalledTimes(1);
    expect(paymentOrders.claimNexiSessionCreation).toHaveBeenCalledWith(
      "checkout-service-test-order"
    );
    expect(createHostedPaymentPage).toHaveBeenCalledTimes(1);
  });

  test("returns pricing_changed instead of retrying terminal order at stale pricing", async () => {
    const staleQuote = buildWorkspaceCheckoutQuote(reservation);
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
            paymentStatus: "cancelled" as const,
          })
        )
      ),
    });

    const result = await runCheckout(
      { payStateToken: makePayStateToken(staleQuote), legalConsent: true },
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
        },
        nexi: { createHostedPaymentPage },
      })
    );

    expect(result.status).toBe("pricing_changed");
    expect(paymentOrders.resetUnsuccessfulForRetry).not.toHaveBeenCalled();
    expect(paymentOrders.claimNexiSessionCreation).not.toHaveBeenCalled();
    expect(createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("rejects ambiguous Dotypos lookup before mutable side effects", async () => {
    const findOrCreateCustomer = mock(() => Effect.succeed({ id: "customer" }));
    const paymentOrders = makePaymentOrderRepository();

    const result = await runCheckout(
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
    );

    expect(result).toEqual({ status: "in_progress" });

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
    if (result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    const token = new URL(result.freshPayUrl, "https://deskohub.test")
      .searchParams.get(payStateTokenQueryParam);
    if (!token) throw new Error("Expected fresh pay URL token");
    expect(openPayState(token).orderId).toBe("checkout-service-test-order");
    expect(paymentOrders.claimNexiSessionCreation).not.toHaveBeenCalled();
    expect(createHostedPaymentPage).not.toHaveBeenCalled();
    expect(paymentOrders.attachNexiSession).not.toHaveBeenCalled();
  });

  test("fresh pricing_changed URL resumes same created order after persisted quote refresh", async () => {
    const staleOrder = makePaymentOrder();
    let order = staleOrder;
    const createHostedPaymentPage = mock(() =>
      Effect.succeed({
        orderId: "checkout-service-test-order",
        hostedPage: "https://nexi.example/hosted",
        securityToken: "token",
      })
    );
    const paymentOrders = makePaymentOrderRepository({
      findById: mock(() => Effect.succeed(order)),
      updateCheckoutDetails: mock((input) => {
        order = makePaymentOrder({
          checkoutDetails: checkoutDetailsJsonSchema.parse({
            ...input.checkoutDetails,
            fulfillment: { accessCodePolicy: "workspace-static-v1" },
          }),
        });
        return Effect.succeed(order);
      }),
    });
    const layer = await makeLayer({
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
    });

    const first = await runCheckout(
      { payStateToken: makePayStateToken(), legalConsent: true },
      layer
    );

    expect(first.status).toBe("pricing_changed");
    expect(paymentOrders.updateCheckoutDetails).toHaveBeenCalledTimes(1);
    if (first.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    const token = new URL(first.freshPayUrl, "https://deskohub.test")
      .searchParams.get(payStateTokenQueryParam);
    if (!token) throw new Error("Expected fresh pay URL token");

    const second = await runCheckout(
      { payStateToken: token, legalConsent: true },
      layer
    );

    expect(second).toEqual({
      status: "redirect",
      redirectUrl: "https://nexi.example/hosted",
    });
    expect(paymentOrders.claimNexiSessionCreation).toHaveBeenCalledWith(
      "checkout-service-test-order"
    );
    expect(createHostedPaymentPage).toHaveBeenCalledTimes(1);
  });

  test("quote preview also fails closed on ambiguous Dotypos lookup", async () => {
    const backend = await loadBackend();
    const dotyposService: DotyposCheckoutTestService = {
      createReservation: mock(() => Effect.die("createReservation not mocked")),
      getReservation: mock(() => Effect.die("getReservation not mocked")),
      getCustomer: mock(() => Effect.die("getCustomer not mocked")),
      findCustomer: mock(() =>
        Effect.succeed({
          _tag: "Ambiguous" as const,
          matches: [{ id: "a" }, { id: "b" }],
        })
      ),
      findOrCreateCustomer: mock(() =>
        Effect.die("findOrCreateCustomer not mocked")
      ),
      getCustomerDiscount: mock(() => Effect.succeed(undefined)),
      getTables: mock(() => Effect.die("getTables not mocked")),
      listReservations: mock(() => Effect.die("listReservations not mocked")),
      getProducts: mock(() => Effect.die("getProducts not mocked")),
      getCategories: mock(() => Effect.die("getCategories not mocked")),
    };

    await expect(
      backend.workspaceQuote
        .buildAuthoritativeWorkspaceCheckoutQuoteEffect(reservation)
        .pipe(
          Effect.provide(Layer.succeed(DotyposService, dotyposService)),
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
    const paymentOrders = makePaymentOrderRepository({
      findById: mock(() => Effect.succeed(makePaymentOrder())),
    });

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

  test("merges legal evidence and starts payment from an active early hold", async () => {
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
      })
    );

    expect(result).toEqual({
      status: "redirect",
      redirectUrl: "https://nexi.example/hosted",
    });
    expect(paymentOrders.create).not.toHaveBeenCalled();
    expect(paymentOrders.updateCheckoutDetails).toHaveBeenCalledTimes(1);
    expect(paymentOrders.claimNexiSessionCreation).toHaveBeenCalledWith(
      "checkout-service-test-order"
    );
    expect(createHostedPaymentPage).toHaveBeenCalledTimes(1);
    expect(paymentOrders.attachNexiSession).toHaveBeenCalledWith({
      id: "checkout-service-test-order",
      securityToken: "token",
      providerOperationId: "checkout-service-test-order",
      providerStatus: "hpp_created",
      providerRedirectUrl: "https://nexi.example/hosted",
    });
    expect(paymentOrders.markPaymentPending).toHaveBeenCalledWith(
      "checkout-service-test-order"
    );
  });
});
