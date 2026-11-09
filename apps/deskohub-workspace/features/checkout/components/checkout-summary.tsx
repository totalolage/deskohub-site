import { Match } from "effect";
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
import { CheckoutSummaryLine } from "./checkout-summary-line";
import {
  CheckoutSummarySection,
  CheckoutSummarySections,
} from "./checkout-summary-section";

type CheckoutSummaryProps = {
  readonly locale: Locale;
  readonly summary: CheckoutSummaryData;
  readonly changedKeys?: CheckoutSummaryChangedKeys;
};

const getSummaryItemLabel = (
  item: CheckoutSummaryData["sections"][number]["items"][number],
  locale: Locale
) => {
  const { key } = item;
  if (key === "addon:coffee")
    return m.checkoutSummaryItemCoffee({}, { locale });

  if (key === "addon:workstation")
    return m.checkoutSummaryItemWorkstation({}, { locale });

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
