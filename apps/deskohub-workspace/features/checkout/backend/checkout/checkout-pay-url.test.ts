import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  buildCheckoutPayContinuationPath,
  buildCheckoutPayPathFromToken,
  buildFreshCheckoutPayPath,
  issueFreshPayState,
  issuePayStateContinuation,
} from "./checkout-pay-url";
import { type BuildSignedPayStateInput, openPayState } from "./pay-state";

const reservation = {
  kind: "cowork" as const,
  entryTier: "basic" as const,
  coffee: false,
  date: "2026-08-04",
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone: "+420777000111",
};
const orderId = "reservation-id" as WorkspaceReservationId;
const changedKeys: CheckoutSummaryChangedKeys = {
  sectionKeys: ["order"],
  itemKeys: ["product:cowork:basic"],
};
const input = {
  locale: "en-US",
  reservation,
  quote: buildCoworkReservationQuote(reservation),
  orderId,
  bookedAt: instantStringSchema.make("2026-06-01T09:58:00.000Z"),
  checkoutSessionId: "checkout-session-id",
} satisfies BuildSignedPayStateInput;
const issuedAt = Temporal.Now.instant();
const stable = { issuedAt, deterministic: true } as const;

const run = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect);
const withKeys = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(TestSealedStateKeys)) as Effect.Effect<A, E>;

describe("issueFreshPayState", () => {
  test("returns the sealed token beside the Pay URL built from it, with the token's expiry", async () => {
    const issued = await run(
      withKeys(issueFreshPayState(input, stable, { orderId }))
    );
    const opened = await run(withKeys(openPayState(issued.payStateToken)));

    expect(issued.payUrl).toBe(
      buildCheckoutPayPathFromToken("en-US", issued.payStateToken, {
        orderId,
      })
    );
    expect(issued.expiresAt).toBe(new Date(opened.exp * 1000).toISOString());
    expect(opened.orderId).toBe(orderId);
  });

  test("keeps the fresh Pay URL builder byte-identical", async () => {
    const [issued, url] = await run(
      withKeys(
        Effect.all([
          issueFreshPayState(input, stable, { orderId }),
          buildFreshCheckoutPayPath(input, stable, { orderId }),
        ])
      )
    );

    expect(url).toBe(issued.payUrl);
  });
});

describe("issuePayStateContinuation", () => {
  test("re-signs a price review without its changed keys", async () => {
    const reviewed = await run(
      withKeys(
        issueFreshPayState({ ...input, changedKeys }, stable).pipe(
          Effect.flatMap(({ payStateToken }) => openPayState(payStateToken))
        )
      )
    );
    const continued = await run(
      withKeys(issuePayStateContinuation(reviewed, stable))
    );
    const opened = await run(withKeys(openPayState(continued.payStateToken)));
    const continuationUrl = await run(
      withKeys(buildCheckoutPayContinuationPath(reviewed, stable))
    );

    expect(reviewed.changedKeys).toEqual(changedKeys);
    expect(opened.changedKeys).toBeUndefined();
    expect(opened.quote).toEqual(reviewed.quote);
    expect(continued.payUrl).toBe(continuationUrl);
    expect(continued.payUrl).toBe(
      buildCheckoutPayPathFromToken("en-US", continued.payStateToken)
    );
  });
});

describe("Pay state issuance failures", () => {
  test("report a server failure, never a rejected caller token", async () => {
    const error = await run(
      withKeys(
        issueFreshPayState({
          ...input,
          quote: { ...input.quote, fingerprint: 42 },
        } as never).pipe(Effect.flip)
      )
    );

    expect(error).toMatchObject({
      _tag: "PayStateIssueError",
      cause: { _tag: "PayStateTokenError" },
    });
  });
});
