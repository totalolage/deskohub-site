import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import {
  buildCheckoutPayPathFromToken,
  getPayStateExpiresAt,
} from "./checkout-pay-url";
import { openPayState } from "./pay-state";
import { acceptPayStatePriceChange } from "./pay-state-price-acceptance";
import {
  sealSyntheticPayStateToken,
  syntheticChangedKeys,
} from "./signed-pay-state.test-utils";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(TestSealedStateKeys)) as Effect.Effect<A, E>
  );
const runFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  run(Effect.flip(effect));

describe("acceptPayStatePriceChange", () => {
  test("continues a price review with the same order and quote, without its changed keys", async () => {
    const payStateToken = await sealSyntheticPayStateToken({
      changedKeys: syntheticChangedKeys,
    });
    const reviewed = await run(openPayState(payStateToken));

    const accepted = await run(
      acceptPayStatePriceChange({ payStateToken, locale: "en-US" })
    );
    const continued = await run(openPayState(accepted.payStateToken));

    expect(accepted.status).toBe("accepted");
    expect(accepted.payStateToken).not.toBe(payStateToken);
    expect(continued.changedKeys).toBeUndefined();
    expect(continued.quote).toEqual(reviewed.quote);
    expect(continued.orderId).toBe(reviewed.orderId);
    expect(continued.acceptedTotal).toEqual(reviewed.acceptedTotal);
    expect(accepted.payUrl).toBe(
      buildCheckoutPayPathFromToken("en-US", accepted.payStateToken)
    );
    expect(accepted.expiresAt).toBe(getPayStateExpiresAt(continued));
  });

  test("returns a state without a price review unchanged", async () => {
    const payStateToken = await sealSyntheticPayStateToken();
    const opened = await run(openPayState(payStateToken));

    const accepted = await run(
      acceptPayStatePriceChange({ payStateToken, locale: "en-US" })
    );

    expect(accepted).toEqual({
      status: "already_accepted",
      payStateToken,
      payUrl: buildCheckoutPayPathFromToken("en-US", payStateToken),
      expiresAt: getPayStateExpiresAt(opened),
    });
  });

  test("rejects a Pay state signed for another language", async () => {
    const payStateToken = await sealSyntheticPayStateToken({
      locale: "cs-CZ",
      changedKeys: syntheticChangedKeys,
    });

    const error = await runFailure(
      acceptPayStatePriceChange({ payStateToken, locale: "en-US" })
    );

    expect(error).toMatchObject({
      _tag: "PayStateTokenError",
      code: "invalid-token",
    });
  });

  test("rejects an expired Pay state", async () => {
    const payStateToken = await sealSyntheticPayStateToken({
      changedKeys: syntheticChangedKeys,
      issuedAt: Temporal.Now.instant().subtract({ hours: 1 }),
    });

    const error = await runFailure(
      acceptPayStatePriceChange({ payStateToken, locale: "en-US" })
    );

    expect(error).toMatchObject({
      _tag: "PayStateTokenError",
      code: "expired",
    });
  });
});
