import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { NexiService } from "@deskohub/nexi";
import { Effect, Layer, Schema } from "effect";
import {
  buildWorkspaceCheckoutQuote,
  type WorkspaceCheckoutQuote,
} from "@/features/checkout/checkout-quote.test-utils";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import type {
  CanonicalDiscountCode,
  DiscountQuote,
} from "@/features/discounts/contracts";
import {
  canonicalDiscountCodeSchema,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";
import {
  buildSignedPayState,
  openPayState,
  payStateTokenQueryParam,
  sealPayState,
} from "./pay-state";

mock.module("server-only", () => ({}));

const testInstant = (value = "2026-06-01T10:00:00Z") =>
  Temporal.Instant.from(value);

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
  readonly quote?: WorkspaceCheckoutQuote;
  readonly submittedCode?: CanonicalDiscountCode;
}) =>
  sealPayState(
    buildSignedPayState({
      locale: input.locale ?? "en-US",
      reservation: reservationData,
      quote: input.quote ?? buildWorkspaceCheckoutQuote(reservationData),
      orderId: input.orderId,
      submittedCode: input.submittedCode,
      ttlMilliseconds: 10 * 60 * 1000,
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
  reservationIntentKey: "intent-key",
  correlationId: "correlation-id",
  dotyposCustomerId: "stored-dotypos-customer-id",
  dotyposReservationId: "dotypos-reservation-id",
  customerAccessCode: "test-access-code",
  productTier: reservationData.entryTier,
  productCoffee: reservationData.coffee,
  productMonitorOption: reservationData.monitorOption,
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
  readonly locale?: Locale;
  readonly acceptedQuote?: WorkspaceCheckoutQuote;
  readonly submittedCode?: CanonicalDiscountCode;
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

  const updateProductIntent = mock((input) =>
    Effect.succeed({ id: input.id } as never)
  );
  const markPaymentTerminal = mock(() => Effect.void);
  const reservations = {
    findById: mock(() =>
      Effect.succeed(
        makeReservation(options.orderId, {
          locale,
          ...options.reservationOverrides,
        })
      )
    ),
    updateProductIntent,
    markPaymentTerminal,
  } as unknown as WorkspaceReservationRepositoryType;
  const updateReservation = mock(() => Effect.void);
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
    mock(({ discountableSubtotal, product }) =>
      Effect.succeed({
        quote: {
          ...undiscountedQuote,
          product,
          discountableSubtotal,
          totalDiscount: { ...discountableSubtotal, value: 0 },
          discountedSubtotal: discountableSubtotal,
        },
        commitment: emptyCommitment,
      })
    );

  const effect = Effect.gen(function* () {
    const service = yield* CheckoutService;
    return yield* service.createHostedPaymentCheckout(
      {
        payStateToken: buildPayStateToken({
          orderId: options.orderId,
          locale,
          quote: options.acceptedQuote,
          submittedCode: options.submittedCode,
        }),
        legalConsent: true,
      },
      locale
    );
  }).pipe(
    Effect.provide(CheckoutServiceLive),
    Effect.provide(DiscountServiceMock({ affirm })),
    Effect.provide(Layer.succeed(DotyposService, dotypos)),
    Effect.provide(Layer.succeed(NexiService, nexi)),
    Effect.provide(Layer.succeed(WorkspaceReservationRepository, reservations)),
    Effect.provide(Layer.succeed(PaymentAttemptRepository, paymentAttempts)),
    Effect.provide(
      Layer.succeed(PostHogEventService, {
        capture: mock(() => Effect.void),
      })
    ),
    Effect.provide(
      Layer.succeed(LegalEvidenceEventRepository, {
        recordMany: mock(() => Effect.void),
      })
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
    updateProductIntent,
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

  test("affirms the accepted discounts with the checkout locale, stored customer, and encrypted code", async () => {
    const submittedCode = canonicalCode("CANONICAL-SECRET-CODE");
    const orderId = "reservation-affirms-code";
    const acceptedQuote = buildWorkspaceCheckoutQuote(reservationData);
    const affirm = mock(() =>
      Effect.succeed({ quote: undiscountedQuote, commitment: emptyCommitment })
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
    expect(affirm).toHaveBeenCalledWith({
      product: { kind: "cowork", tier: "profi" },
      discountableSubtotal: money(55_000),
      reservationDate: reservationData.date,
      dotyposCustomerId: "stored-dotypos-customer-id",
      locale: "cs-CZ",
      submittedCode,
      acceptedDiscountIds: [],
    });
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
    const acceptedQuote = buildWorkspaceCheckoutQuote(reservationData, {
      discountQuote: discountedQuote,
    });
    const acceptedToken = buildPayStateToken({
      orderId: "reservation-label-edited",
      quote: acceptedQuote,
    });
    const affirm = mock(() =>
      Effect.succeed({ quote: editedQuote, commitment: emptyCommitment })
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-label-edited",
      acceptedQuote,
      affirm,
    });

    const result = await Effect.runPromise(harness.effect);

    expect(
      openPayState(acceptedToken).quote.payment.discounts[0]?.discount.label
    ).toBe("Letni sleva 50 %");
    expect(result.status).toBe("pricing_changed");
    if (result.status !== "pricing_changed") {
      throw new Error("Expected pricing_changed result");
    }
    expect(result.changedKeys).toEqual({
      sectionKeys: [],
      itemKeys: ["order/product:cowork:profi"],
    });
    const freshToken = new URL(
      result.freshPayUrl,
      "https://deskohub.test"
    ).searchParams.get(payStateTokenQueryParam);
    expect(
      openPayState(freshToken ?? "").quote.payment.discounts[0]?.discount.label
    ).toBe("Edited English summer label");
  });

  test("returns pricing_changed when an accepted discount disappears before payment", async () => {
    const submittedCode = canonicalCode("SUMMER50");
    const affirm = mock(() =>
      Effect.succeed({ quote: undiscountedQuote, commitment: emptyCommitment })
    );
    const harness = await createCheckoutHarness({
      orderId: "reservation-pricing-changed",
      acceptedQuote: buildWorkspaceCheckoutQuote(reservationData, {
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
    expect(openPayState(freshToken ?? "").submittedCode).toBe(submittedCode);
    expect(affirm).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedDiscountIds: [application.discount.id],
      })
    );
    expect(harness.updateProductIntent).not.toHaveBeenCalled();
    expect(harness.updateReservation).not.toHaveBeenCalled();
    expect(harness.createAttempt).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("refreshes the Dotypos note with public discount labels before provider creation", async () => {
    const events: string[] = [];
    const acceptedQuote = buildWorkspaceCheckoutQuote(reservationData, {
      discountQuote: discountedQuote,
    });
    const affirm = mock(() =>
      Effect.succeed({ quote: discountedQuote, commitment: privateCommitment })
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
      Effect.fail(new Error("Dotypos update failed"))
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
      Effect.fail(new Error("provider create failed"))
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
