import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, spyOn, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { ExternalAPIError, NexiService } from "@deskohub/nexi";
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
import { DiscountClaimError } from "@/features/discounts/errors";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { serializeErrorForLog } from "@/shared/utils/error-formatting";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";
import type { IPaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import { CheckoutPricingServiceMock } from "./checkout-pricing.service.mock";
import {
  checkoutStatePrivacySentinels,
  makeAuthenticatedMalformedPayStateToken,
} from "./checkout-state-observability.test-utils";
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

const money = (value: number, currency = "CZK") => ({
  value,
  exponent: 2,
  currency,
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
  readonly requireCurrent?: ReturnType<typeof mock>;
  readonly activeAttempt?: ReturnType<typeof makeAttempt> | null;
  readonly affirm?: ReturnType<typeof mock>;
  readonly createPendingNexiAttempt?: ReturnType<typeof mock>;
  readonly completeInternalPayment?: ReturnType<typeof mock>;
  readonly createHostedPaymentPage?: ReturnType<typeof mock>;
  readonly fulfillPaidOrder?: ReturnType<typeof mock>;
  readonly capture?: ReturnType<typeof mock>;
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
    findDisplayableForReservation: mock(() => Effect.succeed(null)),
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
              requireCurrent,
            }),
            Layer.succeed(PaymentAttemptRepository, paymentAttempts),
            Layer.succeed(PaymentLifecycleRepository, paymentLifecycle),
            Layer.succeed(WorkspacePaidFulfillmentService, {
              fulfillPaidOrder,
            }),
            Layer.succeed(PostHogEventService, {
              capture,
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
    requireCurrent,
  };
};

describe("CheckoutService", () => {
  test("keeps opaque URL state and decrypted payloads out of checkout logs", async () => {
    const source = await Bun.file(
      new URL("./checkout.service.ts", import.meta.url)
    ).text();
    const start = source.indexOf(
      'createHostedPaymentCheckout: Effect.fn(\n        "checkout.createHostedPaymentCheckout"'
    );
    const end = source.indexOf(
      'yield* Effect.logInfo("Hosted payment checkout pay state opened")',
      start
    );
    const stateOpening = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(stateOpening).not.toContain("annotateLogsScoped({ input");
    expect(stateOpening).not.toContain("annotateLogsScoped({ payState");
    expect(stateOpening).toContain("hasPayStateToken");
    expect(stateOpening).toContain("hasChangedKeys");
  });

  test("keeps checkout token failures on one stable public error", async () => {
    const validToken = buildPayStateToken({
      orderId: "public-error-token",
    });
    const [encodedHeader, ...tokenRest] = validToken.split(".");
    if (!encodedHeader) throw new Error("Expected encoded Pay state header.");
    const header = JSON.parse(
      Buffer.from(encodedHeader, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    const unknownKeyToken = [
      Buffer.from(JSON.stringify({ ...header, kid: "unknown-key" })).toString(
        "base64url"
      ),
      ...tokenRest,
    ].join(".");
    const nonCanonicalToken = validToken
      .split(".")
      .map((part, index) => (index === 1 ? `${part}=` : part))
      .join(".");
    const expiredState = Effect.runSync(
      buildSignedPayState({
        locale: "en-US",
        reservation: reservationData,
        quote: buildCoworkReservationQuote(reservationData),
        orderId: "expired-public-error-token",
        checkoutSessionId: "checkout-session-id",
        ttlMilliseconds: -1,
      })
    );
    const expiredToken = Effect.runSync(sealPayState(expiredState));

    for (const payStateToken of [
      "malformed",
      nonCanonicalToken,
      unknownKeyToken,
      expiredToken,
    ]) {
      const harness = await createCheckoutHarness({
        orderId: "public-error-token",
        payStateToken,
      });

      await expect(Effect.runPromise(harness.effect)).rejects.toMatchObject({
        _tag: "CheckoutError",
        message:
          "Pay state is invalid or expired. Please review checkout again.",
      });
    }
  });

  test("rejects authenticated malformed state before checkout side effects", async () => {
    const harness = await createCheckoutHarness({
      orderId: "authenticated-malformed-state",
      payStateToken: makeAuthenticatedMalformedPayStateToken(),
    });
    const failure = await Effect.runPromise(harness.effect.pipe(Effect.flip));
    const serialized = JSON.stringify(serializeErrorForLog(failure));

    expect(failure).toMatchObject({
      _tag: "CheckoutError",
      message: "Pay state is invalid or expired. Please review checkout again.",
    });
    expect(harness.requireCurrent).not.toHaveBeenCalled();
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
    expect(harness.updateReservationDetails).not.toHaveBeenCalled();
    for (const sentinel of Object.values(checkoutStatePrivacySentinels)) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  test("projects provider-session telemetry closed on the real checkout runtime", async () => {
    const info = spyOn(console, "info").mockImplementation(() => undefined);
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    const providerUrl = checkoutStatePrivacySentinels.providerUrl;
    const harness = await createCheckoutHarness({
      orderId: "provider-log-projection",
      checkoutSessionId: checkoutStatePrivacySentinels.checkoutSessionId,
      createHostedPaymentPage: mock(() =>
        Effect.succeed({
          securityToken: checkoutStatePrivacySentinels.providerToken,
          hostedPage: providerUrl,
        })
      ),
    });

    try {
      await expect(
        harness.effect.pipe(runWorkspaceEffect("checkout.pay.load"))
      ).resolves.toMatchObject({
        status: "redirect",
        redirectUrl: providerUrl,
      });
      const output = JSON.stringify([info.mock.calls, error.mock.calls]);

      expect(output).toContain("operation=checkout.pay.load");
      expect(output).not.toContain("hasProviderRedirectUrl");
      for (const sentinel of Object.values(checkoutStatePrivacySentinels)) {
        expect(output).not.toContain(sentinel);
      }
    } finally {
      info.mockRestore();
      error.mockRestore();
    }
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
      startProviderSession.indexOf("yield* getCheckoutOrderReturnUrl(")
    ).toBeLessThan(createAttemptAt);
    expect(
      startProviderSession.indexOf("yield* getCheckoutPaymentRetryUrl(")
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
    if (result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    const freshPayUrl = result.freshPayUrl;

    expect(result).toMatchObject({
      status: "pricing_changed",
      changedKeys: {
        sectionKeys: ["order", "total"],
        itemKeys: ["product:cowork:profi"],
      },
      freshSummary: expect.any(Object),
      freshPayUrl: expect.stringContaining("/en-US/checkout/pay?payState="),
    });
    const freshToken = new URL(
      freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    if (!freshToken) throw new Error("Expected refreshed Pay state token.");
    expect(freshToken.split(".")).toHaveLength(4);
    expect(
      Effect.runSync(openPayState(freshToken ?? "")).checkoutSessionId
    ).toBe("checkout-session-id");
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
        "/en-US/checkout/status/reservation-zero-total?outcome=success",
    });
    expect(harness.completeInternalPayment).toHaveBeenCalledWith({
      workspaceReservationId: "reservation-zero-total",
      amount: money(0),
      commitment: fullyDiscountedCommitment,
      locale: "en-US",
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
          amount_value: 0,
          provider: "internal",
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
        "/en-US/checkout/status/reservation-already-paid?outcome=success",
    });
    expect(harness.fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: "reservation-already-paid",
    });
    expect(harness.affirm).not.toHaveBeenCalled();
    expect(harness.completeInternalPayment).not.toHaveBeenCalled();
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
        "/en-US/checkout/status/reservation-paid-race?outcome=success",
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
    const freshState = Effect.runSync(openPayState(freshToken ?? ""));
    expect(freshState.submittedCode).toBeUndefined();
    expect(freshState.checkoutSessionId).toBe("checkout-session-id");
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
      workspaceReservationId: "reservation-hpp-create-fails",
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
    if (result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    const freshToken = new URL(
      result.freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(
      Effect.runSync(openPayState(freshToken ?? "")).checkoutSessionId
    ).toBe("checkout-session-id");
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
    if (result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    const freshToken = new URL(
      result.freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(
      Effect.runSync(openPayState(freshToken ?? "")).checkoutSessionId
    ).toBe("checkout-session-id");
    expect(affirm).toHaveBeenCalledTimes(2);
    expect(completeInternalPayment).toHaveBeenCalledTimes(1);
    expect(harness.createPendingNexiAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });
});
