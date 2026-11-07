import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Cause, Context, Effect, Exit, Layer, Option } from "effect";
import {
  sealSyntheticPayStateToken,
  syntheticChangedKeys,
  syntheticPayStateOrderId,
} from "@/features/checkout/backend/checkout/signed-pay-state.test-utils";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import {
  CheckoutServicesUnavailable,
  CustomerCheckoutOperations,
} from "./customer-checkout-operations.service";
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

class Probe extends Context.Service<Probe, { readonly ok: true }>()("Probe") {}

const buildExit = <E>(layer: Layer.Layer<Probe, E>) =>
  Effect.runPromiseExit(
    Effect.flatMap(Probe, () => Effect.void).pipe(
      Effect.provide(CheckoutServicesUnavailable.whenUnbuilt(layer))
    )
  );

const failureOf = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
    : undefined;

describe("CheckoutServicesUnavailable.whenUnbuilt", () => {
  test("answers a Layer that fails to build as unavailable", async () => {
    const exit = await buildExit(
      Layer.effect(Probe, Effect.fail("missing config"))
    );

    expect(failureOf(exit)).toBeInstanceOf(CheckoutServicesUnavailable);
  });

  test("answers a Layer whose construction dies as unavailable", async () => {
    const exit = await buildExit(Layer.effect(Probe, Effect.die("boom")));

    expect(failureOf(exit)).toBeInstanceOf(CheckoutServicesUnavailable);
  });

  test("lets an interrupted construction stay interrupted", async () => {
    const exit = await buildExit(Layer.effect(Probe, Effect.interrupt));

    expect(Exit.hasInterrupts(exit)).toBe(true);
  });
});
