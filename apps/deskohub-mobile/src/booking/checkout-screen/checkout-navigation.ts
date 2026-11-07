import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import { bookFamilyHref, paymentStatusHref } from "../booking-routes";
import type { CheckoutFlowView } from "../checkout/checkout-flow";

/** Where a finished checkout leaves to: the order's status, or the family screen. */
export type CheckoutDestination =
  | ReturnType<typeof paymentStatusHref>
  | ReturnType<typeof bookFamilyHref>;

/** The screen a checkout state leaves to, if it's finished here. */
export const checkoutDestination = (
  view: CheckoutFlowView,
  family: CustomerBookingSelection["family"]
): CheckoutDestination | undefined => {
  if (view._tag === "Starting") return undefined;
  switch (view.state._tag) {
    case "Done":
      return paymentStatusHref(view.state.orderId);
    case "Restart":
      return bookFamilyHref(family, view.state.reason);
    default:
      return undefined;
  }
};

/**
 * - `Navigate`: leave now.
 * - `Drop`: the checkout finished while the customer was elsewhere; stay.
 * - `Stay`: nothing new to act on.
 */
export type NavigationDecision =
  | { readonly _tag: "Navigate"; readonly href: CheckoutDestination }
  | { readonly _tag: "Drop"; readonly href: CheckoutDestination }
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
  handled: CheckoutDestination | undefined
): NavigationDecision => {
  if (destination === undefined || destination === handled) {
    return { _tag: "Stay" };
  }
  return focused
    ? { _tag: "Navigate", href: destination }
    : { _tag: "Drop", href: destination };
};
