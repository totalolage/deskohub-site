"use client";

import { CheckoutSteps } from "@/features/checkout/components/checkout-flow-layout";
import type { Locale } from "@/features/i18n";
import { useReservationCheckoutStep } from "./use-reservation-checkout-step";

/**
 * The checkout steps of a reservation page, which picks the space and takes
 * the contact details in place. At the contact step, "choose your space"
 * goes back with the selection kept.
 */
export function ReservationCheckoutSteps({
  locale,
}: {
  readonly locale: Locale;
}) {
  const { goTo, step } = useReservationCheckoutStep();

  return (
    <CheckoutSteps
      activeStepKey={step === "contact" ? "contact" : "chooseSpace"}
      locale={locale}
      stepLinks={
        step === "contact"
          ? { chooseSpace: { onSelect: () => goTo("selection") } }
          : undefined
      }
    />
  );
}
