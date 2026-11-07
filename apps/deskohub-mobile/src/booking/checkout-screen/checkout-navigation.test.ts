import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { bookFamilyHref, paymentStatusHref } from "../booking-routes";
import type { CheckoutFlowView } from "../checkout/checkout-flow";
import { startCheckout } from "../checkout/checkout-machine";
import { CheckoutState } from "../checkout/checkout-state";
import {
  type CheckoutDestination,
  type CheckoutDestinationHref,
  checkoutDestination,
  leaveCheckout,
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
    ).toEqual({ _tag: "Status", href: paymentStatusHref("order/1") });
    expect(
      checkoutDestination(
        running(CheckoutState.Restart({ reason: "hold_expired" })),
        "meeting-room"
      )
    ).toEqual({
      _tag: "FamilyScreen",
      href: bookFamilyHref("meeting-room", "hold_expired"),
    });
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
  let handled: CheckoutDestinationHref | undefined;
  const navigations: Array<CheckoutDestination> = [];
  for (const { destination, focused } of steps) {
    // Each render makes a new destination; the href identifies it.
    const decision = navigationDecision(
      destination && { ...destination },
      focused,
      handled
    );
    if (decision._tag === "Stay") continue;
    handled = decision.destination.href;
    if (decision._tag === "Navigate") navigations.push(decision.destination);
  }
  return navigations;
};

describe("navigationDecision", () => {
  const status: CheckoutDestination = {
    _tag: "Status",
    href: paymentStatusHref("order-1"),
  };

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

describe("leaveCheckout", () => {
  const recordingRouter = () => {
    const calls: Array<readonly [string, string]> = [];
    return {
      calls,
      router: {
        replace: (href: string) => void calls.push(["replace", href]),
        dismissTo: (href: string) => void calls.push(["dismissTo", href]),
      },
    };
  };

  test("the status replaces the checkout", () => {
    const { calls, router } = recordingRouter();
    const href = paymentStatusHref("order-1");
    leaveCheckout(router, { _tag: "Status", href });
    expect(calls).toEqual([["replace", href]]);
  });

  test("a restart returns to the family screen below the checkout", () => {
    const { calls, router } = recordingRouter();
    const href = bookFamilyHref("cowork", "hold_expired");
    leaveCheckout(router, { _tag: "FamilyScreen", href });
    expect(calls).toEqual([["dismissTo", href]]);
  });
});
