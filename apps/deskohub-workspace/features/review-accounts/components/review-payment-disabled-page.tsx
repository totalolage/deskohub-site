import { CreditCard } from "lucide-react";
import Link from "next/link";
import { getAccountPath } from "@/features/account/routes";
import { CheckoutFlowLayout } from "@/features/checkout/components/checkout-flow-layout";
import { type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import { Button } from "@/shared/components/ui/button";

/**
 * Where a review account's Pay link leads: the booking is simulated, so it
 * says nothing was reserved or charged. Public, since a reviewer may open
 * the link outside the signed-in browser.
 */
export function ReviewPaymentDisabledPage({
  locale,
  orderId,
}: {
  readonly locale: Locale;
  readonly orderId: WorkspaceReservationId;
}) {
  return (
    <CheckoutFlowLayout activeStepKey="pay" locale={locale}>
      <div
        className="rounded-[2.25rem] border border-white/55 bg-white/94 p-6 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm sm:p-10"
        id="review-payment-disabled"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-navy-blue/8 text-navy-blue/60 ring-8 ring-navy-blue/6">
            <CreditCard className="h-9 w-9" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-burned-orange">
              {m.reviewPaymentDisabledEyebrow({}, { locale })}
            </p>
            <h1 className="mt-4 text-balance text-4xl leading-none sm:text-5xl">
              {m.reviewPaymentDisabledTitle({}, { locale })}
            </h1>
            <p className="mt-5 text-lg leading-8 text-navy-blue/70">
              {m.reviewPaymentDisabledLead({}, { locale })}
            </p>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link
              href={`/${locale}${reservationStatusPath}/${encodeURIComponent(orderId)}`}
              prefetch={false}
            >
              {m.reviewPaymentDisabledStatusButton({}, { locale })}
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href={getAccountPath(locale)} prefetch={false}>
              {m.reviewPaymentDisabledReservationsButton({}, { locale })}
            </Link>
          </Button>
        </div>
      </div>
    </CheckoutFlowLayout>
  );
}
