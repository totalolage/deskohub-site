import { type ReactNode, Suspense } from "react";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import type { Locale } from "@/features/i18n";
import { QueryProvider } from "@/shared/components/query-provider";

type ReservationPageProps = {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
  readonly locale: Locale;
  readonly title: string;
};

export function ReservationPage({
  children,
  fallback,
  locale,
  title,
}: ReservationPageProps) {
  return (
    <CheckoutFlowLayout activeStepKey="order" locale={locale}>
      <h1 className="sr-only">{title}</h1>
      <Suspense fallback={fallback}>
        <QueryProvider>{children}</QueryProvider>
      </Suspense>
    </CheckoutFlowLayout>
  );
}
