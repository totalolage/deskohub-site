import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { bookFamilyHref, paymentStatusHref } from "../booking-routes";
import type { CheckoutFlowView } from "../checkout/checkout-flow";
import { startCheckout } from "../checkout/checkout-machine";
import { CheckoutState } from "../checkout/checkout-state";
import {
  type CheckoutDestination,
  checkoutDestination,
  navigationDecision,
} from "./checkout-navigation";

const running = (state: CheckoutState): CheckoutFlowView => ({
  _tag: "Running",
  state,
  now: 0,
});

describe("checkoutDestination", () => {
  test("Done opens the order's status; Restart the family screen with its reason", () => {
    expect(
      checkoutDestination(
        running(CheckoutState.Done({ orderId: "order/1" })),
        "office"
      )
    ).toBe(paymentStatusHref("order/1"));
    expect(
      checkoutDestination(
        running(CheckoutState.Restart({ reason: "hold_expired" })),
        "meeting-room"
      )
    ).toBe(bookFamilyHref("meeting-room", "hold_expired"));
  });

  test("every other state stays on the checkout", () => {
    expect(checkoutDestination({ _tag: "Starting" }, "cowork")).toBeUndefined();
    const details = startCheckout({
      checkoutSessionId: "session-1",
      locale: "en-US",
      selection: { family: "cowork", date: "2026-11-20", tier: "open-space" },
      advertisedPriceToken: "advertised-1",
      rememberedReferralCode: Option.none(),
    });
    expect(checkoutDestination(running(details), "cowork")).toBeUndefined();
    expect(
      checkoutDestination(
        running(CheckoutState.Blocked({ reason: "payment-disabled" })),
        "cowork"
      )
    ).toBeUndefined();
  });
});

/** Replays focus and destination changes as the hook sees them. */
const replay = (
  steps: ReadonlyArray<{
    readonly destination: CheckoutDestination | undefined;
    readonly focused: boolean;
  }>
) => {
  let handled: CheckoutDestination | undefined;
  const navigations: Array<CheckoutDestination> = [];
  for (const { destination, focused } of steps) {
    const decision = navigationDecision(destination, focused, handled);
    if (decision._tag === "Stay") continue;
    handled = decision.href;
    if (decision._tag === "Navigate") navigations.push(decision.href);
  }
  return navigations;
};

describe("navigationDecision", () => {
  const status = paymentStatusHref("order-1");

  test("a destination reached while focused navigates once", () => {
    expect(
      replay([
        { destination: undefined, focused: true },
        { destination: status, focused: true },
        { destination: status, focused: true },
        { destination: status, focused: false },
        { destination: status, focused: true },
      ])
    ).toEqual([status]);
  });

  test("a destination reached while unfocused is dropped, not replayed on return", () => {
    expect(
      replay([
        { destination: undefined, focused: false },
        { destination: status, focused: false },
        { destination: status, focused: true },
      ])
    ).toEqual([]);
  });
});
