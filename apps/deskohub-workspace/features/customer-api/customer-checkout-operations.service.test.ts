import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  sealSyntheticPayStateToken,
  syntheticChangedKeys,
  syntheticPayStateOrderId,
} from "@/features/checkout/backend/checkout/signed-pay-state.test-utils";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { CustomerCheckoutOperations } from "./customer-checkout-operations.service";
import { CustomerReferralUpdates } from "./customer-referral-updates";

/**
 * Runs `use` against the live operations, built for a request whose gates
 * are closed and whose client sent no referral code. Only what an operation
 * builds when it runs is live, so the operations below reach no database,
 * Dotypos or Nexi.
 */
const runOperations = <A, E>(
  use: (
    operations: CustomerCheckoutOperations["Service"]
  ) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    Effect.flatMap(CustomerCheckoutOperations, use).pipe(
      Effect.provide(
        CustomerCheckoutOperations.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              CustomerReferralUpdates.fromClient(undefined),
              ReferralReleaseGate.fromDecision(false),
              OfficeReleaseGate.fromDecision(false)
            )
          )
        )
      )
    )
  );

describe("CustomerCheckoutOperations.Default", () => {
  test("accepts a changed price with the sealing keys alone", async () => {
    const reviewToken = await sealSyntheticPayStateToken({
      changedKeys: syntheticChangedKeys,
    });

    const { accepted, state } = await runOperations((operations) =>
      Effect.gen(function* () {
        const accepted = yield* operations.acceptPriceChange({
          payStateToken: reviewToken,
          locale: "en-US",
        });
        return {
          accepted,
          state: yield* operations.readPayState(accepted.payStateToken),
        };
      })
    );

    expect(accepted.status).toBe("accepted");
    expect(accepted.payStateToken).not.toBe(reviewToken);
    expect(state.orderId).toBe(syntheticPayStateOrderId);
    expect(state.changedKeys).toBeUndefined();
  });

  test("opens a token the server issued", async () => {
    const token = await sealSyntheticPayStateToken();

    const state = await runOperations((operations) =>
      operations.readPayState(token)
    );

    expect(state.orderId).toBe(syntheticPayStateOrderId);
  });
});
