import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { ExternalAPIError, NexiService } from "@deskohub/nexi";
import { Data, Effect, Layer, Schema } from "effect";
import { env } from "@/env";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";
import type { CoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import type {
  CanonicalPromotionCode,
  DiscountQuote,
} from "@/features/discounts/contracts";
import {
  canonicalPromotionCodeSchema,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { DiscountClaimError } from "@/features/discounts/errors";
import type { Locale } from "@/features/i18n";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";
import type { IPaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
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
  duration: { unit: "hour", amount: 4 },
  reservationDate: "2099-06-20",
  startsAt: "2099-06-20T08:00:00Z",
  endsAt: "2099-06-20T12:00:00Z",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
});
if (meetingRoomReservationData.kind !== "meeting-room") {
  throw new Error("Expected meeting-room reservation");
}

const money = (value: number, currency = "CZK") => ({
  value,
  exponent: 2,
  currency,
});

const discountId = Schema.decodeUnknownSync(discountIdSchema);
const canonicalCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema);

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

const fullyDiscountedApplication = {
  ...application,
  discount: {
    ...application.discount,
    adjustment: { kind: "percentage" as const, basisPoints: 10_000 },
  },
  amount: money(55_000),
  subtotalAfter: money(0),
};

const fullyDiscountedQuote: DiscountQuote = {
  product: { kind: "cowork", tier: "profi" },
  discountableSubtotal: money(55_000),
  discounts: [fullyDiscountedApplication],
  totalDiscount: money(55_000),
  discountedSubtotal: money(0),
};

const commitmentProduct = {
  kind: "cowork",
  tier: reservationData.entryTier,
} as const;
const emptyCommitment = makeDiscountCommitment({
  product: commitmentProduct,
  applications: [],
});
const privateCommitment = makeDiscountCommitment({
  product: commitmentProduct,
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
const fullyDiscountedCommitment = makeDiscountCommitment({
  product: commitmentProduct,
  applications: [
    {
      application: fullyDiscountedApplication,
      candidate: {
        discount: fullyDiscountedApplication.discount,
        provenance: {
          providerNamespace: "private-provider-namespace",
          providerReference: "full-discount-reference",
        },
      },
    },
  ],
});

const buildPayStateToken = (input: {
  readonly orderId: string;
  readonly locale?: Locale;
  readonly reservation?: typeof reservationData;
  readonly quote?: CoworkReservationQuote;
  readonly checkoutSessionId?: string;
  readonly submittedCode?: CanonicalPromotionCode;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
}) =>
  Effect.runSync(
    Effect.gen(function* () {
      const reservation = input.reservation ?? reservationData;
      const state = yield* buildSignedPayState({
        locale: input.locale ?? "en-US",
        reservation,
        quote: input.quote ?? buildCoworkReservationQuote(reservation),
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

const buildMeetingRoomQuote = (
  discountQuote?: DiscountQuote,
  reservation = meetingRoomReservationData
) => {
  const quoteWithoutFingerprint = Effect.runSync(
    getMeetingRoomReservationQuote(reservation, {
      discountQuote,
    })
  );

  return {
    ...quoteWithoutFingerprint,
    fingerprint: getReservationQuoteFingerprint(
      reservation,
      quoteWithoutFingerprint
    ),
  };
};

const buildMeetingRoomPayStateToken = (input: {
  readonly orderId: string;
  readonly checkoutSessionId?: string;
  readonly quote?: ReturnType<typeof buildMeetingRoomQuote>;
  readonly reservation?: typeof meetingRoomReservationData;
  readonly submittedCode?: CanonicalPromotionCode;
}) =>
  Effect.runSync(
    Effect.gen(function* () {
      const reservation = input.reservation ?? meetingRoomReservationData;
      const state = yield* buildSignedPayState({
        locale: "en-US",
        reservation,
        quote: input.quote ?? buildMeetingRoomQuote(undefined, reservation),
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

const buildStartedWholeDayReservation = () => {
  const today = Temporal.Now.zonedDateTimeISO(
    workspaceSiteConstants.location.timeZone
  ).toPlainDate();
  const reservation = Schema.decodeUnknownSync(reservationOrderSchema)({
    kind: "meeting-room",
    duration: { unit: "day", amount: 1 },
    reservationDate: today.toString(),
    startsAt: today
      .toPlainDateTime()
      .toZonedDateTime(workspaceSiteConstants.location.timeZone)
      .toInstant()
      .toString(),
    endsAt: today
      .add({ days: 1 })
      .toPlainDateTime()
      .toZonedDateTime(workspaceSiteConstants.location.timeZone)
      .toInstant()
      .toString(),
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420 777 777 777",
  });
  if (reservation.kind !== "meeting-room") {
    throw new Error("Expected meeting-room reservation");
  }

  return reservation;
};

const buildEndedMeetingRoomReservation = () => {
  const yesterday = Temporal.Now.zonedDateTimeISO(
    workspaceSiteConstants.location.timeZone
  )
    .toPlainDate()
    .subtract({ days: 1 });
  const startsAt = yesterday
    .toPlainDateTime({ hour: 12 })
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

  return normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 1 },
    reservationDate: yesterday.toString(),
    startsAt: startsAt.toString(),
    endsAt: startsAt.add({ hours: 1 }).toString(),
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420 777 777 777",
  });
};

const buildEndedOfficeReservation = () => {
  const yesterday = Temporal.Now.zonedDateTimeISO(
    workspaceSiteConstants.location.timeZone
  )
    .toPlainDate()
    .subtract({ days: 1 });

  return normalizedOfficeReservationOrderSchema.make({
    kind: "office",
    startsOn: yesterday.toString(),
    endsOn: yesterday.toString(),
    seats: 3,
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420 777 777 777",
  });
};

const buildOfficePayStateToken = (input: {
  readonly orderId: string;
  readonly reservation: ReturnType<typeof buildEndedOfficeReservation>;
}) =>
  Effect.runSync(
    Effect.gen(function* () {
      const quote = yield* buildOfficeReservationQuote(input.reservation);
      const state = yield* buildSignedPayState({
        locale: "en-US",
        reservation: input.reservation,
        quote,
        orderId: input.orderId,
        checkoutSessionId: "office-checkout-session-id",
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
  orderId: input.orderId,
  workspaceReservationId: input.orderId,
  provider: "nexi" as const,
  providerOrderId: input.id,
  state: input.state ?? ("created" as const),
  amount: money(55_000),
  securityToken: input.securityToken ?? null,
  providerRedirectUrl: input.providerRedirectUrl ?? null,
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: testInstant(),
  updatedAt: testInstant(),
});

const makeReservation = <Overrides extends object>(
  orderId: string,
  overrides?: Overrides
) => ({
  id: orderId,
  checkoutSessionKey: "session-key",
  checkoutAttemptKey: "attempt-key",
  correlationId: "correlation-id",
  dotyposCustomerId: "stored-dotypos-customer-id",
  dotyposReservationId: "dotypos-reservation-id",
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

type CheckoutHarnessOptions<ReservationOverrides extends object> = {
  readonly orderId: string;
  readonly legalConsent?: boolean;
  readonly earlyPerformanceConsent?: boolean;
  readonly payStateToken?: string;
  readonly locale?: Locale;
  readonly acceptedQuote?: CoworkReservationQuote;
  readonly checkoutSessionId?: string;
  readonly submittedCode?: CanonicalPromotionCode;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
  readonly reservationOverrides?: ReservationOverrides;
  readonly requireCurrent?: ReturnType<typeof mock>;
  readonly activeAttempt?: ReturnType<typeof makeAttempt> | null;
  readonly affirm?: ReturnType<typeof mock>;
  readonly createPendingNexiAttempt?: ReturnType<typeof mock>;
  readonly completeInternalPayment?: ReturnType<typeof mock>;
  readonly createHostedPaymentPage?: ReturnType<typeof mock>;
  readonly fulfillPaidOrder?: ReturnType<typeof mock>;
  readonly capture?: ReturnType<typeof mock>;
};

const createCheckoutHarness = async <ReservationOverrides extends object>(
  options: CheckoutHarnessOptions<ReservationOverrides>
) => {
  const locale = options.locale ?? "en-US";
  const { CheckoutService } = await import("./checkout.service");
  const { PayableReservationService } = await import(
    "./payable-reservation.service"
  );
  const { LegalEvidenceEventRepository } = await import(
    "../repositories/legal-evidence-event.repository"
  );
  const { PaymentAttemptRepository } = await import(
    "../repositories/payment-attempt.repository"
  );
  const { PaymentLifecycleRepository } = await import(
    "../repositories/payment-lifecycle.repository"
  );
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
  );
  const { WorkspacePaidFulfillmentService } = await import(
    "../fulfillment/paid-fulfillment.service"
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
  const createPendingNexiAttempt =
    options.createPendingNexiAttempt ??
    mock(() => Effect.succeed(createdAttempt));
  const internalAttempt = {
    ...createdAttempt,
    provider: "internal" as const,
    providerOrderId: null,
    state: "paid" as const,
    amount: money(0),
  };
  const completeInternalPayment =
    options.completeInternalPayment ??
    mock(() =>
      Effect.succeed({
        attempt: internalAttempt,
        changed: true,
        timestamp: testInstant(),
      })
    );
  const fulfillPaidOrder = options.fulfillPaidOrder ?? mock(() => Effect.void);
  const capture = options.capture ?? mock(() => Effect.void);
  const recordLegalEvidence = mock((_input: readonly unknown[]) => Effect.void);
  const findAttempt = mock(() => Effect.succeed(options.activeAttempt ?? null));
  const attachHostedPaymentPage = mock(() => Effect.succeed(attachedAttempt));
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
    findById: findAttempt,
    findByProviderOrderId: mock(() => Effect.succeed(null)),
    findDisplayableForOrder: mock(() => Effect.succeed(null)),
  } satisfies PaymentAttemptRepositoryType;
  const paymentLifecycle = {
    createPendingNexiAttempt,
    completeInternalPayment,
    attachProviderSession: attachHostedPaymentPage,
    markPaid: mock(() =>
      Effect.succeed({
        attempt: createdAttempt,
        changed: true,
        timestamp: testInstant(),
      })
    ),
    markTerminal: markTerminalForReservation,
  } satisfies IPaymentLifecycleRepository;

  const updateReservationDetails = mock((input) =>
    Effect.succeed({ id: input.id } as never)
  );
  const reservationRecord = makeReservation(options.orderId, {
    locale,
    ...options.reservationOverrides,
  });
  const requireCurrent =
    options.requireCurrent ?? mock(() => Effect.succeed(reservationRecord));
  const reservations = {
    findById: mock(() => Effect.succeed(reservationRecord)),
    updateReservationDetails,
  };
  const updateReservation = mock(
    (_input: {
      readonly note?: string;
    }): Effect.Effect<void, CheckoutTestFailure> => Effect.void
  );
  const dotypos = {
    updateReservation,
  };
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
  };
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
        legalConsent: options.legalConsent ?? true,
        earlyPerformanceConsent: options.earlyPerformanceConsent ?? true,
      },
      locale
    );
  }).pipe(
    Effect.provide(
      CheckoutService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            CheckoutPricingServiceMock({
              affirmForPayment: affirmForPayment as never,
            }),
            Layer.mock(DotyposService, dotypos),
            Layer.mock(NexiService, nexi),
            Layer.mock(WorkspaceReservationRepository, reservations),
            Layer.mock(PayableReservationService, {
              requireCurrent,
            }),
            Layer.mock(PaymentAttemptRepository, paymentAttempts),
            Layer.mock(PaymentLifecycleRepository, paymentLifecycle),
            Layer.mock(WorkspacePaidFulfillmentService, {
              fulfillPaidOrder,
            }),
            Layer.mock(PostHogEventService, {
              capture,
            }),
            Layer.mock(LegalEvidenceEventRepository, {
              recordMany: recordLegalEvidence,
            })
          )
        )
      )
    )
  );

  return {
    effect,
    affirm,
    createPendingNexiAttempt,
    completeInternalPayment,
    findAttempt,
    attachHostedPaymentPage,
    markTerminalForReservation,
    updateReservationDetails,
    updateReservation,
    createHostedPaymentPage,
    fulfillPaidOrder,
    capture,
    recordLegalEvidence,
    requireCurrent,
  };
};

describe("CheckoutService", () => {
  test("does not require an early-performance request after the withdrawal period", async () => {
    const harness = await createCheckoutHarness({
      orderId: "reservation-after-withdrawal-period",
      earlyPerformanceConsent: false,
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result.status).toBe("redirect");
    expect(harness.recordLegalEvidence).toHaveBeenCalledWith([
      expect.objectContaining({
        evidence: expect.not.objectContaining({
          acknowledgements: expect.anything(),
        }),
      }),
      expect.anything(),
    ]);
  });

  test("rejects checkout when the required early-performance request is missing", async () => {
    const nearTermReservation = normalizedCoworkReservationOrderSchema.make({
      ...reservationData,
      date: Temporal.Now.zonedDateTimeISO(
        workspaceSiteConstants.location.timeZone
      )
        .toPlainDate()
        .add({ days: 1 })
        .toString(),
    });
    const harness = await createCheckoutHarness({
      orderId: "reservation-missing-early-performance-consent",
      earlyPerformanceConsent: false,
      payStateToken: buildPayStateToken({
        orderId: "reservation-missing-early-performance-consent",
        reservation: nearTermReservation,
      }),
    });

    const error = await Effect.runPromise(Effect.flip(harness.effect));

    expect(error).toMatchObject({
      code: "checkout_failed",
      message: "Early performance consent is required before checkout.",
    });
    expect(harness.requireCurrent).toHaveBeenCalled();
    expect(harness.affirm).toHaveBeenCalled();
    expect(harness.recordLegalEvidence).not.toHaveBeenCalled();
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("records the accepted documents and separate withdrawal acknowledgements", async () => {
    const nearTermReservation = normalizedCoworkReservationOrderSchema.make({
      ...reservationData,
      date: Temporal.Now.zonedDateTimeISO(
        workspaceSiteConstants.location.timeZone
      )
        .toPlainDate()
        .add({ days: 1 })
        .toString(),
    });
    const harness = await createCheckoutHarness({
      orderId: "reservation-records-legal-evidence",
      payStateToken: buildPayStateToken({
        orderId: "reservation-records-legal-evidence",
        reservation: nearTermReservation,
      }),
    });

    await Effect.runPromise(harness.effect);

    expect(harness.recordLegalEvidence).toHaveBeenCalledWith([
      expect.objectContaining({
        evidence: expect.objectContaining({
          documentKey: "termsAndConditions",
          acknowledgements: {
            earlyPerformanceConsent: true,
          },
        }),
      }),
      expect.objectContaining({
        evidence: expect.objectContaining({
          documentKey: "operatingRules",
        }),
      }),
    ]);
  });

  test("prepares fallible local provider inputs before committing an attempt", async () => {
    const source = await Bun.file(
      new URL("./checkout.service.ts", import.meta.url)
    ).text();
    const start = source.indexOf(
      'const startProviderSession = Effect.fn("checkout.startProviderSession")'
    );
    const end = source.indexOf("    return CheckoutService.of({", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const startProviderSession = source.slice(start, end);
    const createAttemptAt = startProviderSession.indexOf(
      "paymentLifecycle.createPendingNexiAttempt"
    );

    expect(createAttemptAt).toBeGreaterThanOrEqual(0);
    expect(startProviderSession.indexOf("toNexiAmount(")).toBeLessThan(
      createAttemptAt
    );
    expect(
      startProviderSession.indexOf("yield* getNotificationUrl")
    ).toBeLessThan(createAttemptAt);
    expect(
      startProviderSession.indexOf("yield* getCheckoutPayReturnUrl(")
    ).toBeLessThan(createAttemptAt);
  });

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
      statusUrl:
        "/en-US/reservation/status/reservation-reuses-provider-attempt",
    });
    expect(harness.findAttempt).toHaveBeenCalledWith(activeAttempt.id);
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.updateReservation).not.toHaveBeenCalled();
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
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
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
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
      amount: money(55_000, "EUR"),
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
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
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
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
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
    expect(harness.createPendingNexiAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: money(55_000),
        commitment: emptyCommitment,
      })
    );
    expect(harness.createHostedPaymentPage).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "55000",
        currency: "EUR",
        customer: {
          id: "stored-dotypos-customer-id",
          name: "Ada Lovelace",
          email: "ada@example.com",
          mobilePhone: {
            countryCallingCode: "420",
            nationalNumber: "777777777",
          },
        },
        resultUrl:
          "http://deskohub.test/cs-CZ/checkout/pay/return/reservation-affirms-code",
        cancelUrl:
          "http://deskohub.test/cs-CZ/checkout/pay/return/reservation-affirms-code?outcome=cancelled",
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

      expect(harness.createPendingNexiAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: expect.objectContaining({ currency: "CZK" }),
        })
      );
      expect(harness.createHostedPaymentPage).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "CZK" })
      );
    } finally {
      env.NEXI_API_ORIGIN = originalNexiOrigin;
    }
  });

  test("completes a zero-total checkout internally without preparing Nexi", async () => {
    const acceptedQuote = buildCoworkReservationQuote(reservationData, {
      discountQuote: fullyDiscountedQuote,
    });
    const affirm = mock(() =>
      Effect.succeed({
        quote: acceptedQuote,
        commitment: fullyDiscountedCommitment,
      })
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-zero-total",
      acceptedQuote,
      affirm,
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toEqual({
      status: "redirect",
      redirectUrl:
        "/en-US/reservation/status/reservation-zero-total?outcome=success",
    });
    expect(harness.completeInternalPayment).toHaveBeenCalledWith({
      orderId: "reservation-zero-total",
      amount: money(0),
      commitment: fullyDiscountedCommitment,
      locale: "en-US",
      accountingSnapshot: expect.objectContaining({
        workspaceReservationId: "reservation-zero-total",
        buyer: { kind: "person", legalName: "Ada Lovelace" },
        billing: { purpose: "personal", invoice: "none" },
        delivery: { email: "ada@example.com" },
      }),
    });
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
    expect(harness.attachHostedPaymentPage).not.toHaveBeenCalled();
    expect(harness.fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: "reservation-zero-total",
    });
    expect(harness.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "payment completed",
        properties: expect.objectContaining({
          provider: "internal",
          revenue: 0,
        }),
      })
    );
  });

  test("does not complete an internal payment when the live hold changes after checkout preparation", async () => {
    const { PayableReservationUnavailableError } = await import(
      "./payable-reservation.service"
    );
    const orderId = "reservation-zero-total-hold-race";
    let validationCount = 0;
    const requireCurrent = mock(() => {
      validationCount += 1;
      return validationCount === 1
        ? Effect.succeed(makeReservation(orderId))
        : Effect.fail(
            new PayableReservationUnavailableError({
              orderId,
              reason: "dotypos_not_pending",
            })
          );
    });
    const acceptedQuote = buildCoworkReservationQuote(reservationData, {
      discountQuote: fullyDiscountedQuote,
    });
    const harness = await createCheckoutHarness({
      orderId,
      acceptedQuote,
      affirm: mock(() =>
        Effect.succeed({
          quote: acceptedQuote,
          commitment: fullyDiscountedCommitment,
        })
      ),
      requireCurrent,
    });

    const result = await Effect.runPromise(harness.effect.pipe(Effect.result));

    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") {
      throw new Error("Expected the invalid live hold to reject checkout");
    }
    expect(result.failure._tag).toBe("CheckoutError");
    expect((result.failure as { cause?: unknown }).cause).toMatchObject({
      _tag: "PayableReservationUnavailableError",
      orderId,
      reason: "dotypos_not_pending",
    });
    expect(requireCurrent).toHaveBeenCalledTimes(2);
    expect(harness.completeInternalPayment).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("keeps an internal payment completed when fulfillment fails", async () => {
    const acceptedQuote = buildCoworkReservationQuote(reservationData, {
      discountQuote: fullyDiscountedQuote,
    });
    const affirm = mock(() =>
      Effect.succeed({
        quote: acceptedQuote,
        commitment: fullyDiscountedCommitment,
      })
    );
    const fulfillPaidOrder = mock(() =>
      Effect.fail(
        new CheckoutTestFailure({
          message: "Fulfillment failed after payment committed.",
        })
      )
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-zero-total-fulfillment-fails",
      acceptedQuote,
      affirm,
      fulfillPaidOrder,
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result.status).toBe("redirect");
    expect(harness.completeInternalPayment).toHaveBeenCalledTimes(1);
    expect(fulfillPaidOrder).toHaveBeenCalledTimes(1);
  });

  test("returns an already-paid checkout status and retries fulfillment idempotently", async () => {
    const harness = await createCheckoutHarness({
      orderId: "reservation-already-paid",
      reservationOverrides: {
        paymentState: "paid",
        paidAt: testInstant(),
      },
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toEqual({
      status: "redirect",
      redirectUrl:
        "/en-US/reservation/status/reservation-already-paid?outcome=success",
    });
    expect(harness.fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: "reservation-already-paid",
    });
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.completeInternalPayment).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("recovers an already-paid checkout after early-performance consent becomes required", async () => {
    const nearTermReservation = normalizedCoworkReservationOrderSchema.make({
      ...reservationData,
      date: Temporal.Now.zonedDateTimeISO(
        workspaceSiteConstants.location.timeZone
      )
        .toPlainDate()
        .add({ days: 1 })
        .toString(),
    });
    const orderId = "reservation-paid-after-consent-cutoff";
    const harness = await createCheckoutHarness({
      orderId,
      earlyPerformanceConsent: false,
      payStateToken: buildPayStateToken({
        orderId,
        reservation: nearTermReservation,
      }),
      reservationOverrides: {
        paymentState: "paid",
        paidAt: testInstant(),
      },
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toEqual({
      status: "redirect",
      redirectUrl: `/en-US/reservation/status/${orderId}?outcome=success`,
    });
    expect(harness.fulfillPaidOrder).toHaveBeenCalledWith({ orderId });
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("recovers an already-paid checkout after payable revalidation loses the race", async () => {
    const { PayableReservationUnavailableError } = await import(
      "./payable-reservation.service"
    );
    const requireCurrent = mock(() =>
      Effect.fail(
        new PayableReservationUnavailableError({
          orderId: "reservation-paid-race",
          reason: "dotypos_not_pending",
        })
      )
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-paid-race",
      reservationOverrides: {
        paymentState: "paid",
        paidAt: testInstant(),
      },
      requireCurrent,
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toEqual({
      status: "redirect",
      redirectUrl:
        "/en-US/reservation/status/reservation-paid-race?outcome=success",
    });
    expect(harness.fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: "reservation-paid-race",
    });
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("affirms meeting-room discounts and returns a fresh state when pricing changes", async () => {
    const submittedCode = canonicalCode("ROOM50");
    const meetingRoomApplication = {
      ...application,
      subtotalBefore: money(155_000),
      amount: money(10_000),
      subtotalAfter: money(145_000),
    };
    const acceptedDiscountQuote: DiscountQuote = {
      product: {
        kind: "meeting-room",
        duration: { unit: "hour", amount: 4 },
      },
      discountableSubtotal: money(155_000),
      discounts: [meetingRoomApplication],
      totalDiscount: money(10_000),
      discountedSubtotal: money(145_000),
    };
    const freshDiscountQuote: DiscountQuote = {
      ...acceptedDiscountQuote,
      discounts: [
        {
          ...meetingRoomApplication,
          amount: money(20_000),
          subtotalAfter: money(135_000),
        },
      ],
      totalDiscount: money(20_000),
      discountedSubtotal: money(135_000),
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
      itemKeys: ["product:meeting-room:hour:4", "total:final"],
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

  test("allows payment for a started whole day before its end", async () => {
    const wholeDayReservation = buildStartedWholeDayReservation();
    const orderId = "meeting-room-started-whole-day";
    const quote = buildMeetingRoomQuote(undefined, wholeDayReservation);
    const affirm = mock(() =>
      Effect.succeed({
        quote,
        commitment: emptyCommitment,
      })
    );
    const harness = await createCheckoutHarness({
      orderId,
      payStateToken: buildMeetingRoomPayStateToken({
        orderId,
        reservation: wholeDayReservation,
        quote,
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

    expect(result).toEqual({
      status: "redirect",
      redirectUrl: "https://payments.example/hosted",
      statusUrl: `/en-US/reservation/status/${orderId}`,
    });
    expect(harness.requireCurrent).toHaveBeenCalled();
    expect(harness.affirm).toHaveBeenCalled();
    expect(harness.createPendingNexiAttempt).toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).toHaveBeenCalled();
  });

  test("rejects payment after a meeting-room reservation ends", async () => {
    const endedReservation = buildEndedMeetingRoomReservation();
    const orderId = "meeting-room-ended";
    const quote = buildMeetingRoomQuote(undefined, endedReservation);
    const harness = await createCheckoutHarness({
      orderId,
      payStateToken: buildMeetingRoomPayStateToken({
        orderId,
        reservation: endedReservation,
        quote,
      }),
      affirm: mock(() =>
        Effect.succeed({
          quote,
          commitment: emptyCommitment,
        })
      ),
      reservationOverrides: {
        productTier: null,
        productCoffee: false,
        productMonitorOption: null,
        reservationDetails: { kind: "meeting-room" },
      },
    });

    const error = await Effect.runPromise(Effect.flip(harness.effect));

    expect(error).toMatchObject({
      _tag: "CheckoutError",
      code: "meeting_room_reservation_ended",
    });
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("rejects payment after an office reservation ends", async () => {
    const endedReservation = buildEndedOfficeReservation();
    const orderId = "office-ended";
    const harness = await createCheckoutHarness({
      orderId,
      payStateToken: buildOfficePayStateToken({
        orderId,
        reservation: endedReservation,
      }),
      reservationOverrides: {
        productTier: null,
        productCoffee: false,
        productMonitorOption: null,
        reservationDetails: { kind: "office" },
      },
    });

    const error = await Effect.runPromise(Effect.flip(harness.effect));

    expect(error).toMatchObject({
      _tag: "CheckoutError",
      code: "office_reservation_ended",
    });
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("recovers an active provider session after the meeting-room reservation ends", async () => {
    const endedReservation = buildEndedMeetingRoomReservation();
    const orderId = "meeting-room-ended-active-payment";
    const quote = buildMeetingRoomQuote(undefined, endedReservation);
    const activeAttempt = {
      ...makeAttempt({
        id: "meeting-room-active-attempt",
        orderId,
        state: "pending",
        securityToken: "active-security-token",
        providerRedirectUrl: "https://payments.example/existing",
      }),
      amount: money(47_500),
    };
    const harness = await createCheckoutHarness({
      orderId,
      earlyPerformanceConsent: false,
      payStateToken: buildMeetingRoomPayStateToken({
        orderId,
        reservation: endedReservation,
        quote,
      }),
      activeAttempt,
      reservationOverrides: {
        activePaymentAttemptId: activeAttempt.id,
        productTier: null,
        productCoffee: false,
        productMonitorOption: null,
        reservationDetails: { kind: "meeting-room" },
      },
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toEqual({
      status: "redirect",
      redirectUrl: "https://payments.example/existing",
      statusUrl: `/en-US/reservation/status/${orderId}`,
    });
    expect(harness.findAttempt).toHaveBeenCalledWith(activeAttempt.id);
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("rechecks the meeting-room end immediately before starting payment", async () => {
    const originalNow = Temporal.Now.instant;
    let now = Temporal.Instant.from("2099-06-10T11:59:00Z");
    Temporal.Now.instant = () => now;
    const reservation = normalizedMeetingRoomReservationOrderSchema.make({
      kind: "meeting-room",
      duration: { unit: "hour", amount: 1 },
      reservationDate: "2099-06-10",
      startsAt: "2099-06-10T11:00:00Z",
      endsAt: "2099-06-10T12:00:00Z",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 777 777",
    });
    const orderId = "meeting-room-ends-during-payment-preparation";
    const quote = buildMeetingRoomQuote(undefined, reservation);
    const affirm = mock(() => {
      now = Temporal.Instant.from("2099-06-10T12:00:00.001Z");
      return Effect.succeed({
        quote,
        commitment: emptyCommitment,
      });
    });

    try {
      const harness = await createCheckoutHarness({
        orderId,
        payStateToken: buildMeetingRoomPayStateToken({
          orderId,
          reservation,
          quote,
        }),
        affirm,
        reservationOverrides: {
          productTier: null,
          productCoffee: false,
          productMonitorOption: null,
          reservationDetails: { kind: "meeting-room" },
        },
      });

      const error = await Effect.runPromise(Effect.flip(harness.effect));

      expect(error).toMatchObject({
        _tag: "CheckoutError",
        message: "Meeting-room reservation has already ended.",
      });
      expect(harness.affirm).toHaveBeenCalled();
      expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
      expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("recovers an already-paid whole day after its start", async () => {
    const wholeDayReservation = buildStartedWholeDayReservation();
    const orderId = "meeting-room-paid-whole-day";
    const harness = await createCheckoutHarness({
      orderId,
      payStateToken: buildMeetingRoomPayStateToken({
        orderId,
        reservation: wholeDayReservation,
      }),
      reservationOverrides: {
        paymentState: "paid",
        paidAt: testInstant(),
        productTier: null,
        productCoffee: false,
        productMonitorOption: null,
        reservationDetails: { kind: "meeting-room" },
      },
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toEqual({
      status: "redirect",
      redirectUrl:
        "/en-US/reservation/status/meeting-room-paid-whole-day?outcome=success",
    });
    expect(harness.fulfillPaidOrder).toHaveBeenCalledWith({ orderId });
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
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
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
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
      statusUrl: "/en-US/reservation/status/reservation-refreshes-note",
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
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("marks HPP provider-create failures atomically for the reservation", async () => {
    const createHostedPaymentPage = mock(() =>
      Effect.fail(
        new ExternalAPIError({
          service: "Nexi",
          operation: "createHostedPaymentPage",
          statusCode: 400,
          message: "provider create failed",
        })
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
      orderId: "reservation-hpp-create-fails",
      state: "failed",
      failureCode: "nexi_hpp_create_failed",
      providerStatus: "hpp_create_failed",
    });
    expect(harness.updateReservation).toHaveBeenCalledTimes(1);
  });

  test("retains an ambiguous HPP creation attempt for reconciliation", async () => {
    const createHostedPaymentPage = mock(() =>
      Effect.fail(
        new ExternalAPIError({
          service: "Nexi",
          operation: "createHostedPaymentPage",
          statusCode: 503,
          message: "provider outcome unknown",
        })
      )
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-hpp-create-ambiguous",
      createHostedPaymentPage,
    });

    await Effect.runPromise(Effect.flip(harness.effect));

    expect(harness.markTerminalForReservation).not.toHaveBeenCalled();
    expect(harness.createPendingNexiAttempt).toHaveBeenCalledTimes(1);
    expect(harness.updateReservation).toHaveBeenCalledTimes(1);
  });

  test("returns refreshed pricing when code claim admission loses a race", async () => {
    const acceptedQuote = buildCoworkReservationQuote(reservationData, {
      discountQuote: discountedQuote,
    });
    const affirm = mock()
      .mockImplementationOnce(() =>
        Effect.succeed({
          quote: acceptedQuote,
          commitment: privateCommitment,
        })
      )
      .mockImplementationOnce(() =>
        Effect.succeed({
          quote: buildCoworkReservationQuote(reservationData),
          commitment: emptyCommitment,
        })
      );
    const createPendingNexiAttempt = mock(() =>
      Effect.fail(
        new DiscountClaimError({
          operation: "reserve",
          reason: "usage_limit_reached",
          message: "The last use was claimed concurrently.",
        })
      )
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-code-claim-race",
      acceptedQuote,
      affirm,
      createPendingNexiAttempt,
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toMatchObject({
      status: "pricing_changed",
      freshSummary: {
        total: money(55_000),
      },
    });
    expect(affirm).toHaveBeenCalledTimes(2);
    expect(createPendingNexiAttempt).toHaveBeenCalledTimes(1);
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("returns refreshed pricing when a zero-total code loses claim admission", async () => {
    const acceptedQuote = buildCoworkReservationQuote(reservationData, {
      discountQuote: fullyDiscountedQuote,
    });
    const affirm = mock()
      .mockImplementationOnce(() =>
        Effect.succeed({
          quote: acceptedQuote,
          commitment: fullyDiscountedCommitment,
        })
      )
      .mockImplementationOnce(() =>
        Effect.succeed({
          quote: buildCoworkReservationQuote(reservationData),
          commitment: emptyCommitment,
        })
      );
    const completeInternalPayment = mock(() =>
      Effect.fail(
        new DiscountClaimError({
          operation: "reserve",
          reason: "usage_limit_reached",
          message: "The last use was claimed concurrently.",
        })
      )
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-zero-total-claim-race",
      acceptedQuote,
      affirm,
      completeInternalPayment,
    });

    const result = await Effect.runPromise(harness.effect);

    expect(result).toMatchObject({
      status: "pricing_changed",
      freshSummary: {
        total: money(55_000),
      },
    });
    expect(affirm).toHaveBeenCalledTimes(2);
    expect(completeInternalPayment).toHaveBeenCalledTimes(1);
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });
});
