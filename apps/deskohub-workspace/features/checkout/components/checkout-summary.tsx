import type {
  CheckoutSummaryChangedKeys,
  CheckoutSummary as CheckoutSummaryData,
} from "@/features/checkout/checkout-quote";
import { formatWorkspaceMoney } from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { cn } from "@/shared/utils";

type CheckoutSummaryProps = {
  readonly locale: Locale;
  readonly summary: CheckoutSummaryData;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
};

const productItemTiers = {
  "product:workspace-basic-day-pass": "basic-day-pass",
  "product:workspace-cowork-plus": "cowork-plus",
  "product:workspace-profi-workstation": "profi-workstation",
} as const;

const summarySectionLabels = {
  order: m.checkoutSummarySectionOrder,
  discount: m.checkoutSummarySectionDiscount,
  total: m.checkoutSummarySectionTotal,
} as const;

const getSummaryItemLabel = (key: string, locale: Locale) => {
  const productTier = productItemTiers[key as keyof typeof productItemTiers];
  if (productTier) return getWorkspaceProductTierTitle(productTier, locale);

  if (key === "addon:coffee")
    return m.checkoutSummaryItemCoffee({}, { locale });

  if (key.startsWith("monitor:")) {
    const monitorOption = key.slice("monitor:".length);
    if (["2x27", "2x32", "qhd-4k"].includes(monitorOption)) {
      return getWorkspaceProductMonitorTitle(
        monitorOption as "2x27" | "2x32" | "qhd-4k",
        locale
      );
    }
  }

  if (key.startsWith("customer-discount:")) {
    return m.checkoutSummaryItemCustomerDiscount({}, { locale });
  }

  if (key === "total:final") return m.checkoutSummaryItemTotal({}, { locale });

  return key;
};

export function CheckoutSummary({
  changedKeys,
  locale,
  summary,
}: CheckoutSummaryProps) {
  return (
    <section className="space-y-3">
      <div className="space-y-3">
        {summary.sections.map((section) => {
          const sectionChanged = changedKeys?.sectionKeys.includes(section.key);

          return (
            <div
              key={section.key}
              className={cn(
                "rounded-2xl border bg-white p-4",
                sectionChanged
                  ? "border-burned-orange/45 ring-4 ring-burned-orange/10"
                  : "border-navy-blue/10"
              )}
            >
              <div className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-navy-blue/58">
                <span>{summarySectionLabels[section.key]({}, { locale })}</span>
              </div>
              <div className="space-y-2">
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
                      <span>{getSummaryItemLabel(item.key, locale)}</span>
                      <span className="shrink-0 font-semibold">
                        {formatWorkspaceMoney(item.amount, locale)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
