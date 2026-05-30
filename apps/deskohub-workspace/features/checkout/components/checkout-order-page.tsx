import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { ReservationForm } from "@/features/reservation/components/reservation-form";
import { Container } from "@/shared/components/container";
import { cn } from "@/shared/utils";

type CheckoutOrderPageProps = {
  locale: Locale;
};

const stepMessageGetters = [
  m.checkoutOrderStepReservation,
  m.checkoutOrderStepPayment,
  m.checkoutOrderStepAccess,
] as const;

export function CheckoutOrderPage({ locale }: CheckoutOrderPageProps) {
  return (
    <main className="min-h-screen overflow-x-clip bg-navy-blue text-white">
      <section className="relative isolate overflow-hidden pb-20 pt-24 sm:pb-24 sm:pt-32">
        <div className="absolute left-1/2 top-16 -z-10 h-80 w-3xl -translate-x-1/2 rotate-[-9deg] rounded-full bg-burned-orange/16 blur-3xl" />
        <div className="absolute -right-28 bottom-24 -z-10 h-72 w-72 rounded-full bg-aquamarine-green/14 blur-3xl" />

        <Container className="max-w-4xl">
          <div className="mx-auto max-w-3xl flex flex-col gap-6">
            <ol
              className="grid gap-2 sm:grid-cols-3"
              aria-label={m.checkoutOrderStepsLabel({}, { locale })}
            >
              {stepMessageGetters.map((getStepLabel, index) => {
                const isCurrentStep = index === 0;

                return (
                  <li
                    key={String(index)}
                    className="flex items-center gap-3 rounded-2xl border border-white/12 bg-white/7 px-4 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white/68"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        isCurrentStep
                          ? "bg-burned-orange text-white"
                          : "border border-white/18 text-white/64"
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className={cn(isCurrentStep && "text-white")}>
                      {getStepLabel({}, { locale })}
                    </span>
                  </li>
                );
              })}
            </ol>

            <Suspense>
              <ReservationForm locale={locale} showIntro={false} />
            </Suspense>
          </div>
        </Container>
      </section>
    </main>
  );
}
