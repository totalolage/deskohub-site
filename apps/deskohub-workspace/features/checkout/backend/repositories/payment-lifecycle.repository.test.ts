import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import type { DiscountCommitment } from "@/features/discounts";
import { getDiscountCommitmentPayload } from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { validateDiscountCommitment } from "./payment-lifecycle.repository";

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
      "const createAttempt = Effect.fn(",
      "      const attachProviderSession"
    );

    expect(createAttempt).toContain(".transaction");
    expect(createAttempt).toContain('.for("update")');
    expect(createAttempt).toContain(".insert(paymentAttempts)");
    expect(createAttempt).toContain(".update(workspaceReservations)");
    expect(createAttempt).toContain(".insert(discountApplications)");
    expect(createAttempt).toContain("yield* reserveCodeClaim");
    expect(createAttempt.indexOf(".insert(paymentAttempts)")).toBeLessThan(
      createAttempt.indexOf(".insert(discountApplications)")
    );
    expect(createAttempt.indexOf(".insert(discountApplications)")).toBeLessThan(
      createAttempt.indexOf("yield* reserveCodeClaim")
    );
  });

  test("locks the code, releases stale claims, then counts active claims before admission", async () => {
    const source = await readRepository();
    const reserveClaim = sliceFrom(
      source,
      'const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")',
      'const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")'
    );

    expect(reserveClaim).toContain(".from(discountCodes)");
    expect(reserveClaim).toContain('.for("update")');
    expect(reserveClaim).toContain(
      'releaseReason: "reservation_expired_before_reuse"'
    );
    expect(reserveClaim).toContain(
      'inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])'
    );
    expect(
      reserveClaim.indexOf('releaseReason: "reservation_expired_before_reuse"')
    ).toBeLessThan(
      reserveClaim.lastIndexOf(
        'inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])'
      )
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
      "      return {\n        createAttempt,"
    );

    expect(paid).toContain("db.transaction");
    expect(paid).toContain("yield* redeemCodeClaim");
    expect(terminal).toContain("db.transaction");
    expect(terminal).toContain("yield* releaseCodeClaim");
  });

  test("rejects inconsistent committed money before opening a transaction", async () => {
    const discountId =
      Schema.decodeUnknownSync(discountIdSchema)("public-discount");
    const commitment = {
      product: { kind: "cowork", tier: "basic" },
      applications: [
        {
          application: {
            discount: {
              id: discountId,
              label: "Test discount",
              adjustment: { kind: "percentage", basisPoints: 2000 },
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
          },
          provenance: {
            providerNamespace: "test",
            providerReference: "test",
          },
        },
      ],
    } as unknown as DiscountCommitment;

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
});
