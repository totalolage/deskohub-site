import { Match } from "effect";
import type { ReactNode } from "react";
import type {
  CheckoutSummaryChangedKeys,
  CheckoutSummary as CheckoutSummaryData,
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
import { CheckoutSummaryDiscountDetails } from "./checkout-summary-discount-details";

type CheckoutSummaryProps = {
  readonly locale: Locale;
  readonly summary: CheckoutSummaryData;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
};

type CheckoutSummarySectionKey = CheckoutSummaryData["sections"][number]["key"];

const summarySectionLabels = {
  order: m.checkoutSummarySectionOrder,
  total: m.checkoutSummarySectionTotal,
} as const;

const getSummaryItemLabel = (
  item: CheckoutSummaryData["sections"][number]["items"][number],
  locale: Locale
) => {
  const { key } = item;
  if ("product" in item) {
    return Match.value(item.product).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: ({ tier }) => getWorkspaceProductTierTitle(tier, locale),
        "meeting-room": ({ durationMinutes }) =>
          getWorkspaceMeetingRoomDurationTitle(durationMinutes, locale),
      })
    );
  }

  if (key === "addon:coffee")
    return m.checkoutSummaryItemCoffee({}, { locale });

  if (key.startsWith("monitor:")) {
    const monitorOption = key.slice("monitor:".length);
    if (isWorkspaceProductMonitorOption(monitorOption)) {
      return getWorkspaceProductMonitorTitle(monitorOption, locale);
    }
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
              const itemLabel = getSummaryItemLabel(item, locale);
              const discountedItem =
                "originalAmount" in item && item.originalAmount
                  ? item
                  : undefined;

              return (
                <div
                  key={item.key}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 text-sm leading-6",
                    itemChanged && "font-semibold text-burned-orange"
                  )}
                >
                  <span>{itemLabel}</span>
                  <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                    {discountedItem && (
                      <>
                        <span className="sr-only">
                          {m.checkoutSummaryOriginalPrice(
                            {
                              price: formatWorkspaceMoney(
                                discountedItem.originalAmount,
                                locale
                              ),
                            },
                            { locale }
                          )}
                        </span>
                        <del
                          aria-hidden="true"
                          className="text-navy-blue/45 decoration-navy-blue/40"
                        >
                          {formatWorkspaceMoney(
                            discountedItem.originalAmount,
                            locale
                          )}
                        </del>
                      </>
                    )}
                    <span className="shrink-0 font-semibold tabular-nums">
                      {discountedItem ? (
                        <>
                          <span className="sr-only">
                            {m.checkoutSummaryDiscountedPrice(
                              {
                                price: formatWorkspaceMoney(
                                  item.amount,
                                  locale
                                ),
                              },
                              { locale }
                            )}
                          </span>
                          <span aria-hidden="true">
                            {formatWorkspaceMoney(item.amount, locale)}
                          </span>
                        </>
                      ) : (
                        formatWorkspaceMoney(item.amount, locale)
                      )}
                    </span>
                    {discountedItem && (
                      <CheckoutSummaryDiscountDetails
                        discounts={discountedItem.discounts}
                        locale={locale}
                        productLabel={itemLabel}
                      />
                    )}
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
