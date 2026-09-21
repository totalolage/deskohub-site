import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Effect, Schema } from "effect";
import {
  type AccountingDocumentSnapshot,
  makeAccountingDocumentSnapshot,
} from "@/features/accounting/accounting-document-snapshot";
import type { PreparedCustomerQuote } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import {
  getDiscountCommitmentPayload,
  makeDiscountCommitment,
} from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { normalizedOfficeReservationOrderSchema } from "@/features/reservation/office-reservation";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { defaultReservationBillingSelection } from "@/features/reservation/reservation-billing";
import {
  getAccountingSnapshotServiceDate,
  validateCommitmentServiceDate,
  validateDiscountCommitment,
  validateInternalPaymentCommitment,
} from "./payment-lifecycle.repository";

const readRepository = () =>
  Bun.file(
    new URL("./payment-lifecycle.repository.ts", import.meta.url)
  ).text();

const sliceFrom = (source: string, startNeedle: string, endNeedle: string) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const makeAccountingSnapshot = (
  prepared: PreparedCustomerQuote
): AccountingDocumentSnapshot =>
  makeAccountingDocumentSnapshot({
    workspaceReservationId: workspaceReservationIdSchema.make(
      "service-date-test-reservation"
    ),
    dotyposReservationId: DotyposReservationIdSchema.make(
      "service-date-test-reservation"
    ),
    dotyposCustomerId: DotyposCustomerIdSchema.make(
      "service-date-test-customer"
    ),
    locale: "en-US",
    prepared,
  });

const makeCoworkSnapshot = (date: string): AccountingDocumentSnapshot => {
  const reservation = normalizedCoworkReservationOrderSchema.make({
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
    date,
    name: "Synthetic Customer",
    email: "service-date@example.test",
    phone: "+420 700 000 000",
    billing: defaultReservationBillingSelection,
  });

  return makeAccountingSnapshot({
    kind: "cowork",
    reservation,
    quote: Effect.runSync(buildCoworkReservationQuote(reservation)),
  });
};

const makeOfficeSnapshot = (
  startsOn: string,
  endsOn: string
): AccountingDocumentSnapshot => {
  const reservation = normalizedOfficeReservationOrderSchema.make({
    kind: "office",
    startsOn,
    endsOn,
    seats: 2,
    name: "Synthetic Customer",
    email: "service-date@example.test",
    phone: "+420 700 000 000",
    billing: defaultReservationBillingSelection,
  });

  return makeAccountingSnapshot({
    kind: "office",
    reservation,
    quote: Effect.runSync(buildOfficeReservationQuote(reservation)),
  });
};

const makeMeetingRoomSnapshot = (input: {
  readonly reservationDate: string;
  readonly startsAt: string;
  readonly endsAt: string;
}): AccountingDocumentSnapshot => {
  const reservation = normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "day", amount: 1 },
    reservationDate: input.reservationDate,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    name: "Synthetic Customer",
    email: "service-date@example.test",
    phone: "+420 700 000 000",
    billing: defaultReservationBillingSelection,
  });
  const quote = Effect.runSync(getMeetingRoomReservationQuote(reservation));

  return makeAccountingSnapshot({
    kind: "meeting-room",
    reservation,
    quote: {
      ...quote,
      fingerprint: getReservationQuoteFingerprint(reservation, quote),
    },
  });
};

describe("PaymentLifecycleRepository", () => {
  test("owns attempt, reservation, applications, and claim admission in one transaction", async () => {
    const source = await readRepository();
    const createPendingNexiAttempt = sliceFrom(
      source,
      "const createPendingNexiAttempt = Effect.fn(",
      "      const completeInternalPayment"
    );

    expect(createPendingNexiAttempt).toContain(".transaction");
    expect(createPendingNexiAttempt).toContain('.for("update")');
    expect(createPendingNexiAttempt).toContain(".insert(paymentAttempts)");
    expect(createPendingNexiAttempt).toContain(
      "persistAccountingDocumentSnapshot"
    );
    expect(createPendingNexiAttempt).toContain(
      ".update(workspaceReservations)"
    );
    expect(createPendingNexiAttempt).toContain(
      "yield* persistDiscountApplications"
    );
    expect(createPendingNexiAttempt).toContain(
      "yield* reserveCommittedCodeClaim"
    );
    expect(
      createPendingNexiAttempt.indexOf("Temporal.Now.instant()")
    ).toBeGreaterThan(createPendingNexiAttempt.indexOf('.for("update")'));
    expect(
      createPendingNexiAttempt.indexOf(".insert(paymentAttempts)")
    ).toBeLessThan(
      createPendingNexiAttempt.indexOf("yield* persistDiscountApplications")
    );
    expect(
      createPendingNexiAttempt.indexOf("yield* persistDiscountApplications")
    ).toBeLessThan(
      createPendingNexiAttempt.indexOf("yield* reserveCommittedCodeClaim")
    );
  });

  test("atomically completes an internal payment with applications and immediate claim redemption", async () => {
    const source = await readRepository();
    const completeInternalPayment = sliceFrom(
      source,
      "const completeInternalPayment = Effect.fn(",
      "      const attachProviderSession"
    );

    expect(completeInternalPayment).toContain(".transaction");
    expect(completeInternalPayment).toContain('.for("update")');
    expect(completeInternalPayment).toContain('provider: "internal"');
    expect(completeInternalPayment).toContain('state: "paid"');
    expect(completeInternalPayment).toContain(".insert(paymentAttempts)");
    expect(completeInternalPayment).toContain(
      "persistAccountingDocumentSnapshot"
    );
    expect(completeInternalPayment).toContain(".update(workspaceReservations)");
    expect(completeInternalPayment).toContain(
      "yield* persistDiscountApplications"
    );
    expect(completeInternalPayment).toContain(
      "yield* reserveCommittedCodeClaim"
    );
    expect(completeInternalPayment).toContain("yield* redeemCodeClaim");
    expect(
      completeInternalPayment.indexOf("Temporal.Now.instant()")
    ).toBeGreaterThan(completeInternalPayment.indexOf('.for("update")'));
    expect(
      completeInternalPayment.indexOf("yield* reserveCommittedCodeClaim")
    ).toBeLessThan(completeInternalPayment.indexOf("yield* redeemCodeClaim"));
  });

  test("uses the admitted claim timestamp for immediate internal redemption", async () => {
    const source = await readRepository();
    const completeInternalPayment = sliceFrom(
      source,
      "const completeInternalPayment = Effect.fn(",
      "      const attachProviderSession"
    );
    const reserveClaim = sliceFrom(
      source,
      'const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")',
      "const validateStoredDiscountClaim = Effect.fn("
    );

    expect(reserveClaim).toContain("return claimedAt");
    expect(completeInternalPayment).toContain(
      "const claimedAt = yield* reserveCommittedCodeClaim"
    );
    expect(completeInternalPayment).toContain(
      "yield* redeemCodeClaim(tx, attemptRow.id, claimedAt)"
    );
    expect(completeInternalPayment).not.toContain(
      "yield* redeemCodeClaim(tx, attemptRow.id, paidAt)"
    );
  });

  test("sets the provider order creation timestamp when the Nexi session attaches", async () => {
    const source = await readRepository();
    const attachProviderSession = sliceFrom(
      source,
      "const attachProviderSession = Effect.fn(",
      "      const markPaid"
    );
    expect(attachProviderSession).toContain(
      "const providerOrderCreatedAt = Temporal.Now.instant()"
    );
    expect(attachProviderSession).toContain("providerOrderCreatedAt,");
    expect(attachProviderSession).toContain(
      "updatedAt: providerOrderCreatedAt"
    );
  });

  test("locks the code and leaves claim release to owning terminal transitions", async () => {
    const source = await readRepository();
    const reserveClaim = sliceFrom(
      source,
      'const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")',
      'export const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")'
    );

    expect(reserveClaim).toContain(".from(discountCodes)");
    expect(reserveClaim).toContain('.for("update")');
    expect(reserveClaim).not.toContain(".update(discountCodeRedemptions)");
    expect(reserveClaim).not.toContain(
      'releaseReason: "reservation_expired_before_reuse"'
    );
    expect(reserveClaim.indexOf("Temporal.Now.instant()")).toBeGreaterThan(
      reserveClaim.indexOf('.for("update")')
    );
    expect(reserveClaim).toContain(
      "Temporal.Instant.compare(input.reservationExpiresAt, claimedAt)"
    );
    expect(reserveClaim).toContain(
      "getPromotionTiming(input.promotion.validUntil)"
    );
    expect(reserveClaim).toContain(
      "currentDefinition.labels[input.locale] !=="
    );
    expect(reserveClaim).toContain("discountProductTargets.productTarget");
    expect(reserveClaim).toContain(
      "getWorkspaceProductTarget(input.claim.product)"
    );
    expect(reserveClaim).not.toContain(
      "eq(discountProductTargets.productTarget, input.claim.product)"
    );
    expect(reserveClaim).toContain(
      'inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])'
    );
    expect(reserveClaim).toContain("code.maxUsesPerCustomer !== null");
    expect(reserveClaim).toContain("customerUses?.count");
    expect(reserveClaim).not.toContain('"already_redeemed"');
    expect(reserveClaim).toContain("validateVoucherClaim");
    expect(reserveClaim).toContain("coalesce(sum(");
    expect(reserveClaim).toContain("discountApplications.appliedAmountValue");
    expect(reserveClaim.indexOf("validateVoucherClaim")).toBeLessThan(
      reserveClaim.indexOf(".insert(discountCodeRedemptions)")
    );
    expect(reserveClaim).toContain(".insert(discountCodeRedemptions)");
    expect(reserveClaim).toContain(".insert(voucherRedemptions)");
  });

  test("redeems and releases claims inside the owning paid and terminal transactions", async () => {
    const source = await readRepository();
    const paid = sliceFrom(
      source,
      'const markPaid = Effect.fn("PaymentLifecycleRepository.markPaid")',
      "      const markTerminal"
    );
    const terminal = sliceFrom(
      source,
      'const markTerminal = Effect.fn("PaymentLifecycleRepository.markTerminal")',
      "      return {\n        createPendingNexiAttempt,"
    );

    expect(paid).toContain("db.transaction");
    expect(paid).toContain("yield* redeemCodeClaim");
    expect(terminal).toContain("db.transaction");
    expect(terminal).toContain("yield* releaseCodeClaim");
    expect(terminal).not.toContain(".delete(accountingDocumentSnapshots)");
    expect(terminal).not.toContain(
      'input.failureCode !== "payment_abandoned_after_provider_cutoff"'
    );
  });

  test("rechecks released claim capacity before late-payment redemption", async () => {
    const source = await readRepository();
    const redeemClaim = sliceFrom(
      source,
      'export const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")',
      "const releaseCodeClaim"
    );

    expect(redeemClaim).toContain(".from(discountCodes)");
    expect(redeemClaim).toContain('.for("update")');
    expect(redeemClaim).toContain("discountCodeRedemptions.dotyposCustomerId");
    expect(redeemClaim).toContain(
      'inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])'
    );
    expect(redeemClaim).toContain('reason: "usage_limit_reached"');
    expect(redeemClaim).toContain(".from(vouchers)");
    expect(redeemClaim).toContain("voucher.issuedAmountValue -");
    expect(redeemClaim).toContain(".update(voucherRedemptions)");
  });

  test("matches promotion claim variants explicitly", async () => {
    const source = await readRepository();

    expect(source).not.toContain('claim?.kind === "discount_code" ?');
    expect(source).not.toContain('yield* input.claim.kind === "discount_code"');
    expect(source).not.toContain('yield* stored.kind === "discount_code"');
    expect(source).not.toContain('yield* claim.kind === "discount"');
  });

  test("rejects inconsistent committed money before opening a transaction", async () => {
    const discountId =
      Schema.decodeUnknownSync(discountIdSchema)("public-discount");
    const application = {
      discount: {
        id: discountId,
        label: "Test discount",
        adjustment: { kind: "percentage" as const, basisPoints: 2000 },
      },
      subtotalBefore: {
        value: 35_000,
        exponent: 2,
        currency: "CZK",
      },
      amount: { value: 7000, exponent: 2, currency: "CZK" },
      subtotalAfter: {
        value: 27_999,
        exponent: 2,
        currency: "CZK",
      },
    };
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      reservationDate: "2026-07-15",
      applications: [
        {
          application,
          candidate: {
            discount: application.discount,
            provenance: {
              providerNamespace: "test",
              providerReference: "test",
            },
          },
        },
      ],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateDiscountCommitment(getDiscountCommitmentPayload(commitment))
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "money_mismatch",
      },
    });
  });

  test("rejects an internal payment without a full-discount commitment", async () => {
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      reservationDate: "2026-07-15",
      applications: [],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateInternalPaymentCommitment(
          getDiscountCommitmentPayload(commitment),
          {
            value: 0,
            exponent: 2,
            currency: "CZK",
          }
        )
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "money_mismatch",
      },
    });
  });

  test("derives the authoritative service date from the validated accounting snapshot", () => {
    const coworkSnapshot = makeCoworkSnapshot("2026-07-15");
    const officeSnapshot = makeOfficeSnapshot("2026-07-15", "2026-07-20");
    const winterMeetingRoomSnapshot = makeMeetingRoomSnapshot({
      reservationDate: "2026-01-16",
      startsAt: "2026-01-15T23:30:00Z",
      endsAt: "2026-01-16T00:30:00Z",
    });
    const springMeetingRoomSnapshots = [
      makeMeetingRoomSnapshot({
        reservationDate: "2026-03-29",
        startsAt: "2026-03-29T00:30:00Z",
        endsAt: "2026-03-29T01:30:00Z",
      }),
      makeMeetingRoomSnapshot({
        reservationDate: "2026-03-29",
        startsAt: "2026-03-29T01:30:00Z",
        endsAt: "2026-03-29T02:30:00Z",
      }),
    ];
    const fallMeetingRoomSnapshots = [
      makeMeetingRoomSnapshot({
        reservationDate: "2026-10-25",
        startsAt: "2026-10-25T00:30:00Z",
        endsAt: "2026-10-25T01:30:00Z",
      }),
      makeMeetingRoomSnapshot({
        reservationDate: "2026-10-25",
        startsAt: "2026-10-25T01:30:00Z",
        endsAt: "2026-10-25T02:30:00Z",
      }),
    ];

    expect(getAccountingSnapshotServiceDate(coworkSnapshot)).toBe("2026-07-15");
    expect(getAccountingSnapshotServiceDate(officeSnapshot)).toBe("2026-07-15");
    // Prague is UTC+1 in winter: 23:30Z is already the next local day.
    expect(getAccountingSnapshotServiceDate(winterMeetingRoomSnapshot)).toBe(
      "2026-01-16"
    );
    // Spring forward (CET -> CEST): both instants resolve on the transition day.
    for (const snapshot of springMeetingRoomSnapshots) {
      expect(getAccountingSnapshotServiceDate(snapshot)).toBe("2026-03-29");
    }
    // Fall back (CEST -> CET): both offsets still resolve on the same day.
    for (const snapshot of fallMeetingRoomSnapshots) {
      expect(getAccountingSnapshotServiceDate(snapshot)).toBe("2026-10-25");
    }
  });

  test("rejects a commitment whose service date no longer matches the accounting snapshot", async () => {
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      reservationDate: "2026-07-15",
      applications: [],
    });
    const payload = getDiscountCommitmentPayload(commitment);

    const mismatch = await Effect.runPromise(
      Effect.result(validateCommitmentServiceDate(payload, "2026-07-16"))
    );
    expect(mismatch).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "claim_conflict",
      },
    });

    const match = await Effect.runPromise(
      Effect.result(validateCommitmentServiceDate(payload, "2026-07-15"))
    );
    expect(match._tag).toBe("Success");
  });

  test("rechecks the locked discount code service window for the snapshot date and leaves vouchers exempt", async () => {
    const source = await readRepository();
    const reserveClaim = sliceFrom(
      source,
      'const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")',
      'export const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")'
    );

    expect(reserveClaim).toContain(
      "isReservationServiceDateEligible(stored.code, input.reservationDate)"
    );
    expect(reserveClaim).toContain('"service_date_ineligible"');
    // The eligibility recheck runs only for discount-code claims.
    expect(reserveClaim).toMatch(
      /stored\.kind === "discount_code" &&\n\s+!isReservationServiceDateEligible/
    );
  });
});
