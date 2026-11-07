import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import type { CheckoutSummaryChangedKeys } from "@/features/checkout/checkout-summary";
import { getEarlyPerformanceRequestRequiredAt } from "@/features/legal/early-performance";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  buildSignedPayState,
  getSignedPayStateCheckoutSummary,
} from "./pay-state";
import { getPayStateCheckoutView } from "./pay-state-checkout-view";

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
const issuedAt = Temporal.Instant.from("2026-07-01T10:00:00Z");

const buildState = (input?: {
  readonly changedKeys?: CheckoutSummaryChangedKeys;
}) =>
  Effect.runPromise(
    buildSignedPayState(
      {
        locale: "en-US",
        reservation,
        quote: buildCoworkReservationQuote(reservation),
        orderId,
        bookedAt: instantStringSchema.make("2026-07-01T09:58:00.000Z"),
        checkoutSessionId: "checkout-session-id",
        changedKeys: input?.changedKeys,
      },
      { issuedAt }
    ).pipe(Effect.provide(TestSealedStateKeys))
  );

describe("getPayStateCheckoutView", () => {
  test("projects the signed order, summary, and token expiry", async () => {
    const state = await buildState();

    const view = getPayStateCheckoutView(state, issuedAt);

    expect(view.orderId).toBe(orderId);
    expect(view.expiresAt).toBe("2026-07-01T10:10:00.000Z");
    expect(view.summary).toEqual(getSignedPayStateCheckoutSummary(state));
    expect(view.changedKeys).toBeUndefined();
  });

  test("carries the changed keys of a price review", async () => {
    const state = await buildState({ changedKeys });

    expect(getPayStateCheckoutView(state, issuedAt).changedKeys).toEqual(
      changedKeys
    );
  });

  test("asks for early-performance consent from the instant the Pay page does", async () => {
    const state = await buildState();
    const requiredAt = getEarlyPerformanceRequestRequiredAt(state.reservation);
    const before = requiredAt.subtract({ seconds: 1 });

    const early = getPayStateCheckoutView(state, before);
    const due = getPayStateCheckoutView(state, requiredAt);

    expect(early.earlyPerformanceConsent).toEqual({
      required: false,
      requiredFrom: requiredAt.toString({ smallestUnit: "millisecond" }),
    });
    expect(due.earlyPerformanceConsent).toEqual({
      required: true,
      requiredFrom: requiredAt.toString({ smallestUnit: "millisecond" }),
    });
  });
});
