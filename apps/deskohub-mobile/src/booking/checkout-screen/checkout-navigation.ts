import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import type { ImperativeRouter } from "expo-router";
import { bookFamilyHref, paymentStatusHref } from "../booking-routes";
import type { CheckoutFlowView } from "../checkout/checkout-flow";

/**
 * Where a finished checkout leaves to, and how:
 * - `Status`: the order's status screen replaces the checkout.
 * - `FamilyScreen`: back to the family screen the checkout was opened from,
 *   which sits below it in the book stack and re-reads its `restart` reason
 *   on refocus. Without it in the stack (such as after a web reload), the
 *   family screen replaces the checkout instead.
 */
export type CheckoutDestination =
  | {
      readonly _tag: "Status";
      readonly href: ReturnType<typeof paymentStatusHref>;
    }
  | {
      readonly _tag: "FamilyScreen";
      readonly href: ReturnType<typeof bookFamilyHref>;
    };

/** The screen a checkout state leaves to, if it's finished here. */
export const checkoutDestination = (
  view: CheckoutFlowView,
  family: CustomerBookingSelection["family"]
): CheckoutDestination | undefined => {
  if (view._tag === "Starting") return undefined;
  switch (view.state._tag) {
    case "Done":
      return { _tag: "Status", href: paymentStatusHref(view.state.orderId) };
    case "Restart":
      return {
        _tag: "FamilyScreen",
        href: bookFamilyHref(family, view.state.reason),
      };
    default:
      return undefined;
  }
};

/** A destination's href, which identifies it across renders. */
export type CheckoutDestinationHref = CheckoutDestination["href"];

/**
 * - `Navigate`: leave now.
 * - `Drop`: the checkout finished while the customer was elsewhere; stay.
 * - `Stay`: nothing new to act on.
 */
export type NavigationDecision =
  | { readonly _tag: "Navigate"; readonly destination: CheckoutDestination }
  | { readonly _tag: "Drop"; readonly destination: CheckoutDestination }
  | { readonly _tag: "Stay" };

/**
 * The checkout screen owns leaving the checkout (R8): it acts on each
 * destination once, and only while it's focused. A destination reached
 * while the customer is on another screen is dropped, not replayed on
 * return, so a late payment result can't pull them away.
 */
export const navigationDecision = (
  destination: CheckoutDestination | undefined,
  focused: boolean,
  handled: CheckoutDestinationHref | undefined
): NavigationDecision => {
  if (destination === undefined || destination.href === handled) {
    return { _tag: "Stay" };
  }
  return focused
    ? { _tag: "Navigate", destination }
    : { _tag: "Drop", destination };
};

/** Leaves the checkout for `destination` (see `CheckoutDestination`). */
export const leaveCheckout = (
  router: Pick<ImperativeRouter, "replace" | "dismissTo">,
  destination: CheckoutDestination
) => {
  switch (destination._tag) {
    case "Status":
      return router.replace(destination.href);
    case "FamilyScreen":
      // Replaces the checkout when the family screen isn't below it.
      return router.dismissTo(destination.href);
  }
};
