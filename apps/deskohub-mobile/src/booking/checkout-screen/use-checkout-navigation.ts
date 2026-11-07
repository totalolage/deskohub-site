import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import { useIsFocused, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import type { CheckoutFlowView } from "../checkout/checkout-flow";
import {
  type CheckoutDestinationHref,
  checkoutDestination,
  leaveCheckout,
  navigationDecision,
} from "./checkout-navigation";

/** Leaves the checkout screen when its flow finishes, per `navigationDecision`. */
export function useCheckoutNavigation(
  view: CheckoutFlowView,
  family: CustomerBookingSelection["family"]
) {
  const router = useRouter();
  const focused = useIsFocused();
  const handled = useRef<CheckoutDestinationHref | undefined>(undefined);
  const destination = checkoutDestination(view, family);
  useEffect(() => {
    const decision = navigationDecision(destination, focused, handled.current);
    if (decision._tag === "Stay") return;
    handled.current = decision.destination.href;
    if (decision._tag === "Navigate")
      leaveCheckout(router, decision.destination);
  }, [destination, focused, router]);
}
