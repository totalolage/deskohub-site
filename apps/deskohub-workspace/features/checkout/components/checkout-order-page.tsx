import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import {
  ReservationForm,
  ReservationFormFallback,
} from "@/features/reservation/components/reservation-form";
import {
  coworkReservationDefaultValues,
  getCoworkTierRequiresMonitorOption,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import { CheckoutFlowLayout } from "./checkout-flow-layout";

type CheckoutOrderPageProps = {
  readonly initialReservation?: NormalizedCoworkReservationOrder;
  readonly locale: Locale;
  readonly checkoutSessionId?: string;
};

export function CheckoutOrderPage({
  initialReservation,
  locale,
  checkoutSessionId,
}: CheckoutOrderPageProps) {
  const showMonitorOptionFallback = getCoworkTierRequiresMonitorOption(
    initialReservation?.entryTier ?? coworkReservationDefaultValues.entryTier
  );

  return (
    <CheckoutFlowLayout activeStepKey="order" locale={locale}>
      {/* Suspense isolates useSearchParams() hydration, not data fetching or lazy loading. */}
      <Suspense
        fallback={
          <ReservationFormFallback
            locale={locale}
            showMonitorOption={showMonitorOptionFallback}
          />
        }
      >
        <ReservationForm
          initialReservation={initialReservation}
          locale={locale}
          checkoutSessionId={checkoutSessionId}
        />
      </Suspense>
    </CheckoutFlowLayout>
  );
}
