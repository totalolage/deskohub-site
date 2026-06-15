import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { cn } from "@/shared/utils";

type CheckoutFlowLayoutProps = {
  readonly activeStepKey: CheckoutStepKey;
  readonly children: ReactNode;
  readonly locale: Locale;
};

type CheckoutStepsProps = {
  readonly activeStepKey: CheckoutStepKey;
  readonly locale: Locale;
};

export const checkoutFlowSteps = [
  { key: "order", getLabel: m.checkoutOrderStepReservation },
  { key: "pay", getLabel: m.checkoutOrderStepPayment },
  { key: "access", getLabel: m.checkoutOrderStepAccess },
] as const;

export type CheckoutStepKey = (typeof checkoutFlowSteps)[number]["key"];

export function CheckoutSteps({ activeStepKey, locale }: CheckoutStepsProps) {
  return (
    <ol
      className="grid gap-2 sm:grid-cols-3"
      aria-label={m.checkoutOrderStepsLabel({}, { locale })}
    >
      {checkoutFlowSteps.map((step, index) => {
        const isCurrentStep = step.key === activeStepKey;

        return (
          <li
            key={step.key}
            aria-current={isCurrentStep ? "step" : undefined}
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
              {step.getLabel({}, { locale })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function CheckoutFlowLayout({
  activeStepKey,
  children,
  locale,
}: CheckoutFlowLayoutProps) {
  return (
    <main className="min-h-screen overflow-x-clip bg-navy-blue text-white">
      <section className="relative isolate overflow-hidden pb-20 pt-24 sm:pb-24 sm:pt-32">
        <div className="absolute left-1/2 top-16 -z-10 h-80 w-3xl -translate-x-1/2 rotate-[-9deg] rounded-full bg-burned-orange/16 blur-3xl" />
        <div className="absolute -right-28 bottom-24 -z-10 h-72 w-72 rounded-full bg-aquamarine-green/14 blur-3xl" />

        <Container className="max-w-4xl">
          <div className="mx-auto max-w-3xl flex flex-col gap-6">
            <CheckoutSteps activeStepKey={activeStepKey} locale={locale} />
            {children}
          </div>
        </Container>
      </section>
    </main>
  );
}
