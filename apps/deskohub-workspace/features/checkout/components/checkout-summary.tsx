import { Match } from "effect";
import type { ReactNode } from "react";
import type {
  CheckoutSummaryChangedKeys,
  CheckoutSummary as CheckoutSummaryData,
} from "@/features/checkout/checkout-summary";
import { isWorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import { getWorkspaceProductMonitorTitle } from "@/features/checkout/product-catalog.i18n";
import { CoworkCheckoutSummaryItem } from "@/features/cowork/components/cowork-checkout-summary-item";
import { type Locale, m } from "@/features/i18n";
import { MeetingRoomCheckoutSummaryItem } from "@/features/meeting-room/components/meeting-room-checkout-summary-item";
import { OfficeCheckoutSummaryItem } from "@/features/office/components/office-checkout-summary-item";
import { cn } from "@/shared/utils";
import { CheckoutSummaryLine } from "./checkout-summary-line";

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
              const itemChanged = changedKeys?.itemKeys.includes(item.key);
              if ("product" in item) {
                return Match.value(item).pipe(
                  Match.when({ product: { kind: "cowork" } }, (productItem) => (
                    <CoworkCheckoutSummaryItem
                      key={productItem.key}
                      changed={itemChanged}
                      item={productItem}
                      locale={locale}
                    />
                  )),
                  Match.when(
                    { product: { kind: "meeting-room" } },
                    (productItem) => (
                      <MeetingRoomCheckoutSummaryItem
                        key={productItem.key}
                        changed={itemChanged}
                        item={productItem}
                        locale={locale}
                      />
                    )
                  ),
                  Match.when({ product: { kind: "office" } }, (productItem) => (
                    <OfficeCheckoutSummaryItem
                      key={productItem.key}
                      changed={itemChanged}
                      item={productItem}
                      locale={locale}
                    />
                  )),
                  Match.exhaustive
                );
              }

              const itemLabel = getSummaryItemLabel(item, locale);

              return (
                <CheckoutSummaryLine
                  key={item.key}
                  amount={item.amount}
                  changed={itemChanged}
                  label={itemLabel}
                  locale={locale}
                />
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
