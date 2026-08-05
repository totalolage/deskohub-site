import { type ReactNode, Suspense } from "react";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import type { Locale } from "@/features/i18n";

type ReservationPageProps = {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
  readonly locale: Locale;
};

export function ReservationPage({
  children,
  fallback,
  locale,
}: ReservationPageProps) {
  return (
    <CheckoutFlowLayout activeStepKey="order" locale={locale}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </CheckoutFlowLayout>
  );
}
