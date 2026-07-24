import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { NexiService } from "@deskohub/nexi";
import { Data, Effect, Layer, Schema } from "effect";
import { env } from "@/env";
import type {
  CheckoutSummaryChangedKeys,
  CoworkReservationQuote,
} from "@/features/checkout/checkout-quote";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import type {
  CanonicalDiscountCode,
  DiscountQuote,
} from "@/features/discounts/contracts";
import {
  canonicalDiscountCodeSchema,
  discountIdSchema,
} from "@/features/discounts/contracts";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";
import { CheckoutPricingServiceMock } from "./checkout-pricing.service.mock";
import {
  buildSignedPayState,
  openPayState,
  payStateTokenQueryParam,
  sealPayState,
} from "./pay-state";

mock.module("server-only", () => ({}));

const testInstant = (value = "2026-06-01T10:00:00Z") =>
  Temporal.Instant.from(value);

class CheckoutTestFailure extends Data.TaggedError("CheckoutTestFailure")<{
  readonly message: string;
}> {}

mock.module("@/features/legal/acceptance-snapshot", () => ({
  getLegalAcceptanceSnapshot: mock(() =>
    Effect.succeed({
      termsAndConditions: {
        path: "/legal/terms.md",
        hash: "terms-test-hash",
        hashAlgorithm: "sha256",
      },
      operatingRules: {
        path: "/legal/rules.md",
        hash: "rules-test-hash",
        hashAlgorithm: "sha256",
      },
    })
  ),
}));

const reservationData = Schema.decodeUnknownSync(
  normalizedCoworkReservationOrderSchema
)({
  kind: "cowork",
  entryTier: "profi",
  date: "2099-06-20",
  coffee: true,
  monitorOption: "2x27-qhd",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
});

const meetingRoomReservationData = Schema.decodeUnknownSync(
  reservationOrderSchema
)({
  kind: "meeting-room",
  startsAt: "2099-06-20T08:00:00Z",
  endsAt: "2099-06-20T12:00:00Z",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
});
if (meetingRoomReservationData.kind !== "meeting-room") {
  throw new Error("Expected meeting-room reservation");
}

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const discountId = Schema.decodeUnknownSync(discountIdSchema);
const canonicalCode = Schema.decodeUnknownSync(canonicalDiscountCodeSchema);

const application = {
  discount: {
    id: discountId("public-summer-sale"),
    label: "Letni sleva 50 %",
    adjustment: { kind: "percentage" as const, basisPoints: 5000 },
  },
  subtotalBefore: money(55_000),
  amount: money(27_500),
  subtotalAfter: money(27_500),
};

const undiscountedQuote: DiscountQuote = {
  product: { kind: "cowork", tier: "profi" },
  discountableSubtotal: money(55_000),
  discounts: [],
  totalDiscount: money(0),
  discountedSubtotal: money(55_000),
};

const discountedQuote: DiscountQuote = {
  product: { kind: "cowork", tier: "profi" },
  discountableSubtotal: money(55_000),
  discounts: [application],
  totalDiscount: money(27_500),
  discountedSubtotal: money(27_500),
};

const emptyCommitment = makeDiscountCommitment({ applications: [] });
const privateCommitment = makeDiscountCommitment({
  applications: [
    {
      application,
      candidate: {
        discount: application.discount,
        provenance: {
          providerNamespace: "private-provider-namespace",
          providerReference: "private-provider-reference",
        },
      },
    },
  ],
});

const buildPayStateToken = (input: {
  readonly orderId: string;
  readonly locale?: Locale;
  readonly quote?: CoworkReservationQuote;
  readonly checkoutSessionId?: string;
  readonly submittedCode?: CanonicalDiscountCode;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
}) =>
  Effect.runSync(
    Effect.gen(function* () {
      const state = yield* buildSignedPayState({
        locale: input.locale ?? "en-US",
        reservation: reservationData,
        quote: input.quote ?? buildCoworkReservationQuote(reservationData),
        orderId: input.orderId,
        checkoutSessionId: input.checkoutSessionId ?? "checkout-session-id",
        ...(input.submittedCode !== undefined && {
          submittedCode: input.submittedCode,
          submittedCodeDiscountId: application.discount.id,
        }),
        changedKeys: input.changedKeys,
        ttlMilliseconds: 10 * 60 * 1000,
      });
      return yield* sealPayState(state);
    })
  );

const buildMeetingRoomQuote = (discountQuote?: DiscountQuote) => {
  const quoteWithoutFingerprint = Effect.runSync(
    getMeetingRoomReservationQuote(meetingRoomReservationData, {
      discountQuote,
    })
  );

  return {
    ...quoteWithoutFingerprint,
    fingerprint: getReservationQuoteFingerprint(
      meetingRoomReservationData,
      quoteWithoutFingerprint
    ),
  };
};

const buildMeetingRoomPayStateToken = (input: {
  readonly orderId: string;
  readonly checkoutSessionId?: string;
  readonly quote?: ReturnType<typeof buildMeetingRoomQuote>;
  readonly submittedCode?: CanonicalDiscountCode;
}) =>
  Effect.runSync(
    Effect.gen(function* () {
      const state = yield* buildSignedPayState({
        locale: "en-US",
        reservation: meetingRoomReservationData,
        quote: input.quote ?? buildMeetingRoomQuote(),
        orderId: input.orderId,
        checkoutSessionId:
          input.checkoutSessionId ?? "meeting-room-checkout-session-id",
        ...(input.submittedCode !== undefined && {
          submittedCode: input.submittedCode,
          submittedCodeDiscountId: application.discount.id,
        }),
        ttlMilliseconds: 10 * 60 * 1000,
      });
      return yield* sealPayState(state);
    })
  );

const makeAttempt = (input: {
  readonly id: string;
  readonly orderId: string;
  readonly state?: "created" | "pending" | "failed";
  readonly securityToken?: string | null;
  readonly providerRedirectUrl?: string | null;
}) => ({
  id: input.id,
  workspaceReservationId: input.orderId,
  provider: "nexi" as const,
  providerOrderId: input.id,
  state: input.state ?? ("created" as const),
  amountValue: 55_000,
  amountExponent: 2,
  currency: "CZK",
  securityToken: input.securityToken ?? null,
  providerRedirectUrl: input.providerRedirectUrl ?? null,
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: testInstant(),
  updatedAt: testInstant(),
});

const makeReservation = (
  orderId: string,
  overrides: Record<string, unknown> = {}
) => ({
  id: orderId,
  checkoutSessionKey: "session-key",
  checkoutAttemptKey: "attempt-key",
  correlationId: "correlation-id",
  dotyposCustomerId: "stored-dotypos-customer-id",
  dotyposReservationId: "dotypos-reservation-id",
  customerAccessCode: "test-access-code",
  productTier: reservationData.entryTier,
  productCoffee: reservationData.coffee,
  productMonitorOption: reservationData.monitorOption,
  reservationDetails: {
    kind: "cowork" as const,
    entryTier: reservationData.entryTier,
    coffee: reservationData.coffee,
    monitorOption: reservationData.monitorOption,
  },
  locale: "en-US",
  reservationState: "held",
  reservationHoldExpiresAt: testInstant("2099-06-20T10:00:00.000Z"),
  reservationHoldExpiredAt: null,
  reservationCreatedAt: testInstant("2026-06-01T10:00:00.000Z"),
  reservationCancelledAt: null,
  cancellationClaimedAt: null,
  holdExpiredAt: null,
  holdCreationClaimedAt: null,
  paymentState: "not_started",
  activePaymentAttemptId: null,
  failureCode: null,
  paidAt: null,
  fulfillmentState: "not_started",
  fulfillmentClaimedAt: null,
  fulfilledAt: null,
  fulfillmentFailedAt: null,
  fulfillmentFailureCode: null,
  reservationConfirmedAt: null,
  createdAt: testInstant(),
  updatedAt: testInstant(),
  ...overrides,
});

type CheckoutHarnessOptions = {
  readonly orderId: string;
  readonly payStateToken?: string;
  readonly locale?: Locale;
  readonly acceptedQuote?: CoworkReservationQuote;
  readonly checkoutSessionId?: string;
  readonly submittedCode?: CanonicalDiscountCode;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly reservationOverrides?: Record<string, unknown>;
  readonly activeAttempt?: ReturnType<typeof makeAttempt> | null;
  readonly affirm?: ReturnType<typeof mock>;
  readonly createHostedPaymentPage?: ReturnType<typeof mock>;
};

const createCheckoutHarness = async (options: CheckoutHarnessOptions) => {
  const locale = options.locale ?? "en-US";
  const { CheckoutService, CheckoutServiceLive } = await import(
    "./checkout.service"
  );
  const { PayableReservationService } = await import(
    "./payable-reservation.service"
  );
  const { LegalEvidenceEventRepository } = await import(
    "../repositories/legal-evidence-event.repository"
  );
  const { PaymentAttemptRepository } = await import(
    "../repositories/payment-attempt.repository"
  );
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );

  const createdAttempt = makeAttempt({
    id: `attempt-${options.orderId}`,
    orderId: options.orderId,
  });
  const attachedAttempt = {
    ...createdAttempt,
    state: "pending" as const,
    securityToken: "provider-security-token",
    providerRedirectUrl: "https://payments.example/hosted",
  };
  const createAttempt = mock(() => Effect.succeed(createdAttempt));
  const findAttempt = mock(() => Effect.succeed(options.activeAttempt ?? null));
  const attachHostedPaymentPage = mock(() => Effect.succeed(attachedAttempt));
  const markTerminal = mock(() => Effect.void);
  const markTerminalForReservation = mock(() =>
    Effect.succeed({
      attempt: {
        ...createdAttempt,
        state: "failed" as const,
        failureCode: "nexi_hpp_create_failed",
        lastProviderStatus: "hpp_create_failed",
      },
      changed: true,
      timestamp: testInstant(),
    })
  );
  const paymentAttempts = {
    create: createAttempt,
    findById: findAttempt,
    findByProviderOrderId: mock(() => Effect.succeed(null)),
    findDisplayableForReservation: mock(() => Effect.succeed(null)),
    attachHostedPaymentPage,
    markPaid: mock(() => Effect.void),
    markTerminal,
    markPaidForReservation: mock(() =>
      Effect.succeed({
        attempt: createdAttempt,
        changed: true,
        timestamp: testInstant(),
      })
    ),
    markTerminalForReservation,
  } satisfies PaymentAttemptRepositoryType;

  const updateReservationDetails = mock((input) =>
    Effect.succeed({ id: input.id } as never)
  );
  const markPaymentTerminal = mock(() => Effect.void);
  const reservationRecord = makeReservation(options.orderId, {
    locale,
    ...options.reservationOverrides,
  });
  const reservations = {
    findById: mock(() => Effect.succeed(reservationRecord)),
    updateReservationDetails,
    markPaymentTerminal,
  } as unknown as WorkspaceReservationRepositoryType;
  const updateReservation = mock(
    (_input: {
      readonly note?: string;
    }): Effect.Effect<void, CheckoutTestFailure> => Effect.void
  );
  const dotypos = {
    updateReservation,
  } as unknown as typeof DotyposService.Service;
  const createHostedPaymentPage =
    options.createHostedPaymentPage ??
    mock(() =>
      Effect.succeed({
        securityToken: "provider-security-token",
        hostedPage: "https://payments.example/hosted",
      })
    );
  const nexi = {
    createHostedPaymentPage,
    verifyPaymentOutcome: mock(() => Effect.die("not used")),
  } as unknown as typeof NexiService.Service;
  const affirm =
    options.affirm ??
    mock(() =>
      Effect.succeed({
        quote: buildCoworkReservationQuote(reservationData),
        commitment: emptyCommitment,
      })
    );
  const affirmForPayment = (pricingInput: Parameters<typeof affirm>[0]) =>
    affirm(pricingInput).pipe(
      Effect.map((result) => ({
        kind: pricingInput.reservation.kind,
        reservation: pricingInput.reservation,
        ...result,
      }))
    );

  const effect = Effect.gen(function* () {
    const service = yield* CheckoutService;
    return yield* service.createHostedPaymentCheckout(
      {
        payStateToken:
          options.payStateToken ??
          buildPayStateToken({
            orderId: options.orderId,
            locale,
            quote: options.acceptedQuote,
            checkoutSessionId: options.checkoutSessionId,
            submittedCode: options.submittedCode,
            changedKeys: options.changedKeys,
          }),
        legalConsent: true,
      },
      locale
    );
  }).pipe(
    Effect.provide(
      CheckoutServiceLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            CheckoutPricingServiceMock({
              affirmForPayment: affirmForPayment as never,
            }),
            Layer.succeed(DotyposService, dotypos),
            Layer.succeed(NexiService, nexi),
            Layer.succeed(WorkspaceReservationRepository, reservations),
            Layer.succeed(PayableReservationService, {
              requireCurrent: mock(() => Effect.succeed(reservationRecord)),
            }),
            Layer.succeed(PaymentAttemptRepository, paymentAttempts),
            Layer.succeed(PostHogEventService, {
              capture: mock(() => Effect.void),
            }),
            Layer.succeed(LegalEvidenceEventRepository, {
              recordMany: mock((_input: readonly unknown[]) => Effect.void),
            })
          )
        )
      )
    )
  );

  return {
    effect,
    affirm,
    createAttempt,
    findAttempt,
    attachHostedPaymentPage,
    markTerminal,
    markTerminalForReservation,
    markPaymentTerminal,
    updateReservationDetails,
    updateReservation,
    createHostedPaymentPage,
  };
};

describe("CheckoutService", () => {
  test("redirects a reusable active attempt before discount affirmation and note refresh", async () => {
    const orderId = "reservation-reuses-provider-attempt";
    const activeAttempt = makeAttempt({
      id: "active-attempt",
      orderId,
      state: "pending",
      securityToken: "active-security-token",
      providerRedirectUrl: "https://payments.example/existing",
    });
    const harness = await createCheckoutHarness({
      orderId,
      activeAttempt,
      changedKeys: {
        sectionKeys: ["order", "total"],
        itemKeys: ["product:cowork:profi"],
      },
      reservationOverrides: { activePaymentAttemptId: activeAttempt.id },
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toEqual({
      status: "redirect",
      redirectUrl: "https://payments.example/existing",
    });
    expect(harness.findAttempt).toHaveBeenCalledWith(activeAttempt.id);
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.updateReservation).not.toHaveBeenCalled();
    expect(harness.createAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("does not reuse an active attempt whose amount differs from the signed summary", async () => {
    const orderId = "reservation-rejects-mismatched-provider-attempt";
    const activeAttempt = makeAttempt({
      id: "active-attempt",
      orderId,
      state: "pending",
      securityToken: "active-security-token",
      providerRedirectUrl: "https://payments.example/existing",
    });
    const harness = await createCheckoutHarness({
      orderId,
      acceptedQuote: buildCoworkReservationQuote(reservationData, {
        discountQuote: discountedQuote,
      }),
      activeAttempt,
      reservationOverrides: { activePaymentAttemptId: activeAttempt.id },
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toEqual({ status: "in_progress" });
    expect(harness.findAttempt).toHaveBeenCalledWith(activeAttempt.id);
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.createAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("does not reuse an active attempt persisted in a provider override currency", async () => {
    const orderId = "reservation-rejects-provider-currency-attempt";
    const activeAttempt = {
      ...makeAttempt({
        id: "active-attempt",
        orderId,
        state: "pending",
        securityToken: "active-security-token",
        providerRedirectUrl: "https://payments.example/existing",
      }),
      currency: "EUR",
    };
    const harness = await createCheckoutHarness({
      orderId,
      activeAttempt,
      reservationOverrides: { activePaymentAttemptId: activeAttempt.id },
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toEqual({ status: "in_progress" });
    expect(harness.findAttempt).toHaveBeenCalledWith(activeAttempt.id);
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.createAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("returns the existing pricing change for a review-required state before provider work", async () => {
    const harness = await createCheckoutHarness({
      orderId: "reservation-review-required",
      changedKeys: {
        sectionKeys: ["order", "total"],
        itemKeys: ["product:cowork:profi"],
      },
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toMatchObject({
      status: "pricing_changed",
      changedKeys: {
        sectionKeys: ["order", "total"],
        itemKeys: ["product:cowork:profi"],
      },
      freshSummary: expect.any(Object),
      freshPayUrl: expect.stringContaining("/en-US/checkout/pay?payState="),
    });
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.updateReservation).not.toHaveBeenCalled();
    expect(harness.createAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("affirms the accepted discounts with the checkout locale, stored customer, and encrypted code", async () => {
    const submittedCode = canonicalCode("CANONICAL-SECRET-CODE");
    const orderId = "reservation-affirms-code";
    const acceptedQuote = buildCoworkReservationQuote(reservationData);
    const affirm = mock(() =>
      Effect.succeed({
        quote: buildCoworkReservationQuote(reservationData, {
          discountQuote: undiscountedQuote,
        }),
        commitment: emptyCommitment,
      })
    );
    const harness = await createCheckoutHarness({
      orderId,
      locale: "cs-CZ",
      acceptedQuote,
      submittedCode,
      affirm,
    });

    const token = buildPayStateToken({
      orderId,
      quote: acceptedQuote,
      submittedCode,
    });
    expect(token).not.toContain(submittedCode);

    await Effect.runPromise(harness.effect);

    expect(affirm).toHaveBeenCalledTimes(1);
    expect(affirm).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation: expect.objectContaining(reservationData),
        dotyposCustomerId: "stored-dotypos-customer-id",
        locale: "cs-CZ",
        submittedCode,
        quote: acceptedQuote,
      })
    );
    expect(harness.createAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        amountValue: 55_000,
        amountExponent: 2,
        currency: "CZK",
      })
    );
    expect(harness.createHostedPaymentPage).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "55000",
        currency: "EUR",
      })
    );
  });

  test("does not apply the sandbox currency override to a lookalike hostname", async () => {
    const originalNexiOrigin = env.NEXI_API_ORIGIN;
    env.NEXI_API_ORIGIN =
      "https://xpaysandbox.nexigroup.com.attacker.example/api";

    try {
      const harness = await createCheckoutHarness({
        orderId: "reservation-lookalike-nexi-origin",
      });

      await Effect.runPromise(harness.effect);

      expect(harness.createAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "CZK" })
      );
      expect(harness.createHostedPaymentPage).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "CZK" })
      );
    } finally {
      env.NEXI_API_ORIGIN = originalNexiOrigin;
    }
  });

  test("affirms meeting-room discounts and returns a fresh state when pricing changes", async () => {
    const submittedCode = canonicalCode("ROOM50");
    const meetingRoomApplication = {
      ...application,
      subtotalBefore: money(60_000),
      amount: money(10_000),
      subtotalAfter: money(50_000),
    };
    const acceptedDiscountQuote: DiscountQuote = {
      product: { kind: "meeting-room", durationMinutes: 240 },
      discountableSubtotal: money(60_000),
      discounts: [meetingRoomApplication],
      totalDiscount: money(10_000),
      discountedSubtotal: money(50_000),
    };
    const freshDiscountQuote: DiscountQuote = {
      ...acceptedDiscountQuote,
      discounts: [
        {
          ...meetingRoomApplication,
          amount: money(20_000),
          subtotalAfter: money(40_000),
        },
      ],
      totalDiscount: money(20_000),
      discountedSubtotal: money(40_000),
    };
    const affirm = mock(() =>
      Effect.succeed({
        quote: buildMeetingRoomQuote(freshDiscountQuote),
        commitment: emptyCommitment,
      })
    );
    const orderId = "meeting-room-pricing-changed";
    const checkoutSessionId = "meeting-room-session-id";
    const acceptedQuote = buildMeetingRoomQuote(acceptedDiscountQuote);
    const harness = await createCheckoutHarness({
      orderId,
      payStateToken: buildMeetingRoomPayStateToken({
        orderId,
        checkoutSessionId,
        quote: acceptedQuote,
        submittedCode,
      }),
      affirm,
      reservationOverrides: {
        productTier: null,
        productCoffee: false,
        productMonitorOption: null,
        reservationDetails: { kind: "meeting-room" },
      },
    });

    const result = await Effect.runPromise(harness.effect);

    expect(affirm).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation: meetingRoomReservationData,
        dotyposCustomerId: "stored-dotypos-customer-id",
        locale: "en-US",
        submittedCode,
        quote: acceptedQuote,
      })
    );
    expect(result.status).toBe("pricing_changed");
    if (result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    expect(result.changedKeys).toEqual({
      sectionKeys: ["order", "total"],
      itemKeys: ["product:meeting-room:240", "total:final"],
    });
    const freshToken = new URL(
      result.freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    const freshState = Effect.runSync(openPayState(freshToken ?? ""));
    expect(freshState.reservation.kind).toBe("meeting-room");
    expect(freshState.checkoutSessionId).toBe(checkoutSessionId);
    expect(freshState.submittedCode).toBe(submittedCode);
    expect(freshState.submittedCodeDiscountId).toBe(application.discount.id);
  });

  test("treats a translated-label edit as a quote change while retaining the accepted snapshot", async () => {
    const editedApplication = {
      ...application,
      discount: {
        ...application.discount,
        label: "Edited English summer label",
      },
    };
    const editedQuote: DiscountQuote = {
      ...discountedQuote,
      discounts: [editedApplication],
    };
    const acceptedQuote = buildCoworkReservationQuote(reservationData, {
      discountQuote: discountedQuote,
    });
    const acceptedToken = buildPayStateToken({
      orderId: "reservation-label-edited",
      quote: acceptedQuote,
      checkoutSessionId: "reservation-label-edited-session-id",
    });
    const affirm = mock(() =>
      Effect.succeed({
        quote: buildCoworkReservationQuote(reservationData, {
          discountQuote: editedQuote,
        }),
        commitment: emptyCommitment,
      })
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-label-edited",
      acceptedQuote,
      checkoutSessionId: "reservation-label-edited-session-id",
      affirm,
    });

    const result = await Effect.runPromise(harness.effect);

    expect(
      Effect.runSync(openPayState(acceptedToken)).quote.payment.discounts[0]
        ?.discount.label
    ).toBe("Letni sleva 50 %");
    expect(result.status).toBe("pricing_changed");
    if (result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    expect(result.changedKeys).toEqual({
      sectionKeys: [],
      itemKeys: ["product:cowork:profi"],
    });
    const freshToken = new URL(
      result.freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    const freshState = Effect.runSync(openPayState(freshToken ?? ""));
    expect(freshState.quote.payment.discounts[0]?.discount.label).toBe(
      "Edited English summer label"
    );
    expect(freshState.checkoutSessionId).toBe(
      "reservation-label-edited-session-id"
    );
  });

  test("returns pricing_changed when an accepted discount disappears before payment", async () => {
    const submittedCode = canonicalCode("SUMMER50");
    const affirm = mock(() =>
      Effect.succeed({
        quote: buildCoworkReservationQuote(reservationData, {
          discountQuote: undiscountedQuote,
        }),
        commitment: emptyCommitment,
      })
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-pricing-changed",
      acceptedQuote: buildCoworkReservationQuote(reservationData, {
        discountQuote: discountedQuote,
      }),
      submittedCode,
      affirm,
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result.status).toBe("pricing_changed");
    if (result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    const freshToken = new URL(
      result.freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(
      Effect.runSync(openPayState(freshToken ?? "")).submittedCode
    ).toBeUndefined();
    expect(affirm).toHaveBeenCalledWith(
      expect.objectContaining({
        quote: expect.objectContaining({
          payment: expect.objectContaining({
            discounts: [application],
          }),
        }),
      })
    );
    expect(harness.updateReservationDetails).not.toHaveBeenCalled();
    expect(harness.updateReservation).not.toHaveBeenCalled();
    expect(harness.createAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("refreshes the Dotypos note with public discount labels before provider creation", async () => {
    const events: string[] = [];
    const acceptedQuote = buildCoworkReservationQuote(reservationData, {
      discountQuote: discountedQuote,
    });
    const affirm = mock(() =>
      Effect.succeed({
        quote: buildCoworkReservationQuote(reservationData, {
          discountQuote: discountedQuote,
        }),
        commitment: privateCommitment,
      })
    );
    const createHostedPaymentPage = mock(() => {
      events.push("provider-created");
      return Effect.succeed({
        securityToken: "provider-security-token",
        hostedPage: "https://payments.example/hosted",
      });
    });
    const harness = await createCheckoutHarness({
      orderId: "reservation-refreshes-note",
      acceptedQuote,
      affirm,
      createHostedPaymentPage,
    });
    harness.updateReservation.mockImplementation((input) => {
      events.push("note-updated");
      return Effect.succeed(input).pipe(Effect.asVoid);
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toEqual({
      status: "redirect",
      redirectUrl: "https://payments.example/hosted",
    });
    expect(events).toEqual(["note-updated", "provider-created"]);
    expect(harness.updateReservation).toHaveBeenCalledTimes(1);
    const note = harness.updateReservation.mock.calls[0]?.[0]?.note;
    expect(note).toContain("Discount: Letni sleva 50 % (");
    expect(note).toContain("-CZK\u00a0275");
    expect(note).not.toContain("public-summer-sale");
    expect(note).not.toContain("private-provider-namespace");
    expect(note).not.toContain("private-provider-reference");
  });

  test("does not create a payment attempt when the Dotypos note refresh fails", async () => {
    const harness = await createCheckoutHarness({
      orderId: "reservation-note-refresh-fails",
    });
    harness.updateReservation.mockImplementation(() =>
      Effect.fail(new CheckoutTestFailure({ message: "Dotypos update failed" }))
    );

    const error = await Effect.runPromise(Effect.flip(harness.effect));

    expect(error).toMatchObject({
      _tag: "CheckoutError",
      message:
        "Payment checkout could not be started. Please review your details and try again.",
    });
    expect(harness.createAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("marks HPP provider-create failures atomically for the reservation", async () => {
    const createHostedPaymentPage = mock(() =>
      Effect.fail(
        new CheckoutTestFailure({ message: "provider create failed" })
      )
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-hpp-create-fails",
      createHostedPaymentPage,
    });

    await Effect.runPromise(Effect.flip(harness.effect));

    expect(harness.markTerminalForReservation).toHaveBeenCalledTimes(1);
    expect(harness.markTerminalForReservation).toHaveBeenCalledWith({
      id: "attempt-reservation-hpp-create-fails",
      workspaceReservationId: "reservation-hpp-create-fails",
      state: "failed",
      failureCode: "nexi_hpp_create_failed",
      providerStatus: "hpp_create_failed",
    });
    expect(harness.markTerminal).not.toHaveBeenCalled();
    expect(harness.markPaymentTerminal).not.toHaveBeenCalled();
    expect(harness.updateReservation).toHaveBeenCalledTimes(1);
  });
});
