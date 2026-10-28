import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  getDiscountCommitmentPayload,
  makeDiscountCommitment,
} from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import {
  redeemCodeClaim,
  validateDiscountCommitment,
  validateInternalPaymentCommitment,
} from "./payment-lifecycle.repository";

describe("PaymentLifecycleRepository", () => {
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

  test("re-redeems a released code claim within the per-customer use limit", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      // Released claim of this payment attempt.
      [["customer-1", "code-1", "released"]],
      // No voucher claim.
      [],
      // Code without total or per-customer limits.
      [[null, null]],
      // The same customer redeemed the code once more since the release.
      [[1]],
      [],
    ]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { transaction } = yield* WorkspaceDatabase;
        return yield* transaction(
          redeemCodeClaim(
            "attempt-1" as never,
            Temporal.Instant.from("2026-01-01T00:00:00Z"),
            true
          )
        );
      }).pipe(Effect.provide(recording.layer), Effect.result)
    );

    expect(result._tag).toBe("Success");
    expect(
      recording.statements.some(({ sql }) =>
        sql.startsWith('update "discount_code_redemptions"')
      )
    ).toBe(true);
  });

  test("refuses to re-redeem a released code claim beyond the per-customer use limit", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      [["customer-1", "code-1", "released"]],
      [],
      // One use per customer.
      [[null, 1]],
      // The customer already holds another active use.
      [[1]],
      [],
    ]);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { transaction } = yield* WorkspaceDatabase;
        return yield* transaction(
          redeemCodeClaim(
            "attempt-1" as never,
            Temporal.Instant.from("2026-01-01T00:00:00Z"),
            true
          )
        );
      }).pipe(Effect.provide(recording.layer), Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(result.failure).toMatchObject({
      _tag: "DiscountClaimError",
      reason: "usage_limit_reached",
    });
    expect(
      recording.statements.some(({ sql }) =>
        sql.startsWith('update "discount_code_redemptions"')
      )
    ).toBe(false);
  });
});
