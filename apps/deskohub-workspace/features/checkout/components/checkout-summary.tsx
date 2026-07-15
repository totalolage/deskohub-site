import type { ReactNode } from "react";
import type {
  CheckoutSummaryChangedKeys,
  CheckoutSummary as CheckoutSummaryData,
  CheckoutSummaryItem,
} from "@/features/checkout/checkout-quote";
import { isWorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import {
  getWorkspaceMeetingRoomDurationTitle,
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { cn } from "@/shared/utils";

type CheckoutSummaryProps = {
  readonly locale: Locale;
  readonly summary: CheckoutSummaryData;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
};

type CheckoutSummarySectionKey = CheckoutSummaryData["sections"][number]["key"];

const productItemTiers = {
  "product:basic": "basic",
  "product:plus": "plus",
  "product:profi": "profi",
  "product:workspace-basic": "basic",
  "product:workspace-plus": "plus",
  "product:workspace-profi": "profi",
} as const;

const summarySectionLabels = {
  order: m.checkoutSummarySectionOrder,
  discount: m.checkoutSummarySectionDiscount,
  total: m.checkoutSummarySectionTotal,
} as const;

const getSummaryItemLabel = (item: CheckoutSummaryItem, locale: Locale) => {
  if (item.meetingRoomDurationMinutes) {
    return getWorkspaceMeetingRoomDurationTitle(
      item.meetingRoomDurationMinutes,
      locale
    );
  }

  const productTier =
    productItemTiers[item.key as keyof typeof productItemTiers];
  if (productTier) return getWorkspaceProductTierTitle(productTier, locale);

  if (item.key === "addon:coffee")
    return m.checkoutSummaryItemCoffee({}, { locale });

  if (item.key.startsWith("monitor:")) {
    const monitorOption = item.key.slice("monitor:".length);
    if (isWorkspaceProductMonitorOption(monitorOption)) {
      return getWorkspaceProductMonitorTitle(monitorOption, locale);
    }
  }

  if (item.key.startsWith("customer-discount:")) {
    return m.checkoutSummaryItemCustomerDiscount({}, { locale });
  }

  if (item.key === "total:final")
    return m.checkoutSummaryItemTotal({}, { locale });

  return item.key;
};

export function CheckoutSummary({
  changedKeys,
  locale,
  summary,
}: CheckoutSummaryProps) {
  return (
    <CheckoutSummarySections>
      {summary.sections.map((section) => {
        const sectionChanged = changedKeys?.sectionKeys.includes(section.key);

        return (
          <CheckoutSummarySection
            key={section.key}
            changed={sectionChanged}
            locale={locale}
            sectionKey={section.key}
          >
            {section.items.map((item) => {
              const itemKey = `${section.key}/${item.key}`;
              const itemChanged = changedKeys?.itemKeys.includes(itemKey);

              return (
                <div
                  key={item.key}
                  className={cn(
                    "flex items-start justify-between gap-4 text-sm leading-6",
                    itemChanged && "font-semibold text-burned-orange"
                  )}
                >
                  <span>{getSummaryItemLabel(item, locale)}</span>
                  <span className="shrink-0 font-semibold">
                    {formatWorkspaceMoney(item.amount, locale)}
                  </span>
                </div>
              );
            })}
          </CheckoutSummarySection>
        );
      })}
    </CheckoutSummarySections>
  );
}

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
