import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  makeDiscountCommitment,
  materializeDiscountCommitment,
} from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
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

describe("PaymentLifecycleRepository", () => {
  test("owns attempt, reservation, applications, and claim admission in one transaction", async () => {
    const source = await readRepository();
    const createAttempt = sliceFrom(
      source,
      "const admitPaymentStart = Effect.fn(",
      "      const completeInternalPayment"
    );

    expect(createAttempt).toContain(".transaction");
    expect(createAttempt).toContain('.for("update")');
    expect(createAttempt).toContain(".insert(paymentAttempts)");
    expect(createAttempt).toContain(".update(workspaceReservations)");
    expect(createAttempt).toContain(".insert(discountApplications)");
    expect(createAttempt).toContain("yield* reserveCodeClaim");
    expect(createAttempt).toContain(
      "reservationHoldExpiresAt} > clock_timestamp()"
    );
    expect(createAttempt.indexOf(".insert(paymentAttempts)")).toBeLessThan(
      createAttempt.indexOf(".insert(discountApplications)")
    );
    expect(createAttempt.indexOf(".insert(discountApplications)")).toBeLessThan(
      createAttempt.indexOf("yield* reserveCodeClaim")
    );
  });

  test("atomically completes internal payment, applications, and claim redemption", async () => {
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
    expect(completeInternalPayment).toContain(".update(workspaceReservations)");
    expect(completeInternalPayment).toContain(
      "yield* persistDiscountApplications"
    );
    expect(completeInternalPayment).toContain(
      "yield* reserveCommittedCodeClaim"
    );
    expect(completeInternalPayment).toContain("yield* redeemCodeClaim");
  });

  test("locks the code and leaves claim release to owning terminal transitions", async () => {
    const source = await readRepository();
    const reserveClaim = sliceFrom(
      source,
      'const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")',
      'const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")'
    );

    expect(reserveClaim).toContain(".from(discountCodes)");
    expect(reserveClaim).toContain('.for("update")');
    expect(reserveClaim).not.toContain(".update(discountCodeRedemptions)");
    expect(reserveClaim).not.toContain(
      'releaseReason: "reservation_expired_before_reuse"'
    );
    expect(reserveClaim).toContain("const claimedAt = input.databaseNow");
    expect(reserveClaim).toContain(
      "Temporal.Instant.compare(input.reservationExpiresAt, claimedAt)"
    );
    expect(reserveClaim).toContain("getDiscountCodeTiming(code.validUntil)");
    expect(reserveClaim).toContain(
      "currentDefinition.labels[input.locale] !=="
    );
    expect(reserveClaim).toContain(
      'inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])'
    );
    expect(reserveClaim).toContain(".insert(discountCodeRedemptions)");
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
      "      return {\n        admitPaymentStart,"
    );

    expect(paid).toContain("db.transaction");
    expect(paid).toContain("yield* redeemCodeClaim");
    expect(terminal).toContain("db.transaction");
    expect(terminal).toContain("yield* releaseCodeClaim");
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
        validateDiscountCommitment(
          materializeDiscountCommitment(commitment, [application]) as Extract<
            ReturnType<typeof materializeDiscountCommitment>,
            { readonly status: "ready" }
          >
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

  test("rejects an internal payment without a full-discount commitment", async () => {
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      applications: [],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateInternalPaymentCommitment(
          materializeDiscountCommitment(commitment, []) as Extract<
            ReturnType<typeof materializeDiscountCommitment>,
            { readonly status: "ready" }
          >,
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
});
