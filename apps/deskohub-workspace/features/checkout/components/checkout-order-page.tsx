import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { ReservationForm } from "@/features/reservation/components/reservation-form";
import { CheckoutFlowLayout } from "./checkout-flow-layout";

type CheckoutOrderPageProps = {
  locale: Locale;
};

export function CheckoutOrderPage({ locale }: CheckoutOrderPageProps) {
  return (
    <CheckoutFlowLayout activeStepIndex={0} locale={locale}>
      <Suspense>
        <ReservationForm locale={locale} showIntro={false} />
      </Suspense>
    </CheckoutFlowLayout>
  );
}
