import type { Money } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { Text } from "../../ui/text";
import { formatMoney } from "./money";

/** What a summary line is, from its key (`CustomerCheckoutSummaryItem.key`). */
export type SummaryLineKind =
  | { readonly _tag: "Product"; readonly product: string }
  | { readonly _tag: "Coffee" }
  | { readonly _tag: "Workstation" }
  | { readonly _tag: "Monitor"; readonly option: string }
  | { readonly _tag: "Other"; readonly key: string };

/** One summary line as the review shows it. */
export interface SummaryLineView {
  readonly key: string;
  readonly kind: SummaryLineKind;
  readonly amount: Money;
  /** The price before discounts, on a discounted line. */
  readonly originalAmount: Option.Option<Money>;
  readonly discounts: ReadonlyArray<{
    readonly label: string;
    readonly amount: Money;
  }>;
  /** Office lines: the days and seats booked, with each part's price. */
  readonly office: Option.Option<{
    readonly dayCount: number;
    readonly seats: number;
    readonly accessAmount: Option.Option<Money>;
    /** Every seat for every day booked. */
    readonly seatTotal: Option.Option<Money>;
  }>;
  /** The price review names this line as changed. */
  readonly changed: boolean;
}

export interface SummaryView {
  readonly lines: ReadonlyArray<SummaryLineView>;
  readonly total: Money;
  readonly totalChanged: boolean;
}

/**
 * A booking's itemized price: each line with its original price and
 * discounts, office days and seats, then the total. Lines a price review
 * changed are marked and say so to assistive technology.
 */
export function PriceSummary({
  summary,
  lineLabel,
  locale,
}: {
  readonly summary: SummaryView;
  readonly lineLabel: (line: SummaryLineView) => string;
  readonly locale: AppLocale;
}) {
  const changedLabel = m.booking_checkout_summary_changed({}, { locale });
  return (
    <View style={styles.summary}>
      {summary.lines.map((line) => (
        <SummaryLine
          key={line.key}
          line={line}
          label={lineLabel(line)}
          changedLabel={changedLabel}
          locale={locale}
        />
      ))}
      <View
        style={[
          styles.row,
          styles.totalRow,
          summary.totalChanged && styles.changed,
        ]}
      >
        <Text style={styles.totalLabel}>
          {m.booking_checkout_summary_total({}, { locale })}
        </Text>
        <View style={styles.amounts}>
          {summary.totalChanged && (
            <Text style={styles.changedTag}>{changedLabel}</Text>
          )}
          <Text style={styles.totalAmount}>
            {formatMoney(summary.total, locale)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function SummaryLine({
  line,
  label,
  changedLabel,
  locale,
}: {
  readonly line: SummaryLineView;
  readonly label: string;
  readonly changedLabel: string;
  readonly locale: AppLocale;
}) {
  return (
    <View style={[styles.line, line.changed && styles.changed]}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.amounts}>
          {Option.isSome(line.originalAmount) && (
            <Text
              style={styles.original}
              aria-label={m.booking_checkout_summary_original_price(
                { amount: formatMoney(line.originalAmount.value, locale) },
                { locale }
              )}
            >
              {formatMoney(line.originalAmount.value, locale)}
            </Text>
          )}
          <Text style={styles.amount}>{formatMoney(line.amount, locale)}</Text>
        </View>
      </View>
      {line.changed && <Text style={styles.changedTag}>{changedLabel}</Text>}
      {Option.isSome(line.office) && (
        <OfficeBreakdown office={line.office.value} locale={locale} />
      )}
      {line.discounts.map((discount) => (
        <View key={discount.label} style={styles.row}>
          <Text style={styles.detail}>{discount.label}</Text>
          <Text style={styles.detail}>
            {`−${formatMoney(discount.amount, locale)}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

function OfficeBreakdown({
  office,
  locale,
}: {
  readonly office: Option.Option.Value<SummaryLineView["office"]>;
  readonly locale: AppLocale;
}) {
  return (
    <View>
      <View style={styles.row}>
        <Text style={styles.detail}>
          {m.booking_checkout_summary_office_days(
            { count: office.dayCount },
            { locale }
          )}
        </Text>
        {Option.isSome(office.accessAmount) && (
          <Text style={styles.detail}>
            {formatMoney(office.accessAmount.value, locale)}
          </Text>
        )}
      </View>
      <View style={styles.row}>
        <Text style={styles.detail}>
          {m.booking_checkout_summary_office_seats(
            { count: office.seats },
            { locale }
          )}
        </Text>
        {Option.isSome(office.seatTotal) && (
          <Text style={styles.detail}>
            {formatMoney(office.seatTotal.value, locale)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  line: { gap: theme.spacing.xs, borderRadius: theme.radius.sm },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: theme.spacing.md,
  },
  amounts: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.sm,
  },
  label: { ...theme.type.body, flex: 1, color: theme.colors.text },
  amount: { ...theme.type.body, color: theme.colors.text },
  original: {
    ...theme.type.caption,
    color: theme.colors.textMuted,
    textDecorationLine: "line-through",
  },
  detail: { ...theme.type.caption, color: theme.colors.textMuted },
  changed: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.warning,
    paddingLeft: theme.spacing.sm,
  },
  changedTag: {
    ...theme.type.caption,
    color: theme.colors.warning,
    fontWeight: "600",
  },
  totalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.sm,
  },
  totalLabel: {
    ...theme.type.heading,
    flex: 1,
    color: theme.colors.text,
  },
  totalAmount: { ...theme.type.heading, color: theme.colors.accent },
});
