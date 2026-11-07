import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import { useIsFocused, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import type { CheckoutFlowView } from "../checkout/checkout-flow";
import {
  type CheckoutDestination,
  checkoutDestination,
  navigationDecision,
} from "./checkout-navigation";

/** Leaves the checkout screen when its flow finishes, per `navigationDecision`. */
export function useCheckoutNavigation(
  view: CheckoutFlowView,
  family: CustomerBookingSelection["family"]
) {
  const router = useRouter();
  const focused = useIsFocused();
  const handled = useRef<CheckoutDestination | undefined>(undefined);
  const destination = checkoutDestination(view, family);
  useEffect(() => {
    const decision = navigationDecision(destination, focused, handled.current);
    if (decision._tag === "Stay") return;
    handled.current = decision.href;
    if (decision._tag === "Navigate") router.replace(decision.href);
  }, [destination, focused, router]);
}
