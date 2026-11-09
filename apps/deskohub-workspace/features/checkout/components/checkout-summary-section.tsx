import type { ReactNode } from "react";
import type { CheckoutSummary as CheckoutSummaryData } from "@/features/checkout/checkout-summary";
import { type Locale, m } from "@/features/i18n";
import { cn } from "@/shared/utils";

type CheckoutSummarySectionKey = CheckoutSummaryData["sections"][number]["key"];

const summarySectionLabels = {
  order: m.checkoutSummarySectionOrder,
  total: m.checkoutSummarySectionTotal,
} as const;

export function CheckoutSummarySections({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function CheckoutSummarySection({
  changed,
  children,
  locale,
  sectionKey,
}: {
  readonly changed?: boolean;
  readonly children: ReactNode;
  readonly locale: Locale;
  readonly sectionKey: CheckoutSummarySectionKey;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-4",
        changed
          ? "border-burned-orange/45 ring-4 ring-burned-orange/10"
          : "border-navy-blue/10"
      )}
    >
      <div className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-navy-blue/58">
        <span>{summarySectionLabels[sectionKey]({}, { locale })}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
