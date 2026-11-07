import type {
  CustomerBookingSelection,
  CustomerLocale,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { StyleSheet, Text, View } from "react-native";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { formatPragueDate, formatPragueTime } from "../ui/prague-date-format";
import {
  bookingOverviewOf,
  type MeetingRoomTime,
  type BookingOverview as Overview,
} from "./booking-overview";
import { productLabel } from "./checkout-copy";

type Row = { readonly label: string; readonly value: string };

const range = (start: string, end: string, locale: CustomerLocale) =>
  m.booking_checkout_overview_range({ start, end }, { locale });

const dateRow = (date: string, locale: CustomerLocale): Row => ({
  label: m.booking_checkout_overview_date({}, { locale }),
  value: formatPragueDate(date, locale),
});

const timeText = (time: MeetingRoomTime, locale: CustomerLocale) =>
  time._tag === "WholeDay"
    ? m.booking_checkout_overview_whole_day({}, { locale })
    : range(
        formatPragueTime(time.start, locale),
        formatPragueTime(time.end, locale),
        locale
      );

const overviewRows = (
  overview: Overview,
  locale: CustomerLocale
): ReadonlyArray<Row> => {
  switch (overview._tag) {
    case "Cowork":
      return [dateRow(overview.date, locale)];
    case "MeetingRoom":
      return [
        dateRow(overview.date, locale),
        ...Option.toArray(
          Option.map(overview.time, (time) => ({
            label: m.booking_checkout_overview_time({}, { locale }),
            value: timeText(time, locale),
          }))
        ),
      ];
    case "Office":
      return [
        overview.firstDate === overview.lastDate
          ? dateRow(overview.firstDate, locale)
          : {
              label: m.booking_checkout_overview_dates({}, { locale }),
              value: range(
                formatPragueDate(overview.firstDate, locale),
                formatPragueDate(overview.lastDate, locale),
                locale
              ),
            },
        {
          label: m.booking_checkout_overview_seats({}, { locale }),
          value: String(overview.seats),
        },
      ];
  }
};

/**
 * What is booked and when, above the price: the product, its date or dates,
 * a meeting room's time and early setup, and an office's seats.
 */
export function BookingOverviewView({
  selection,
  earlySetup,
  locale,
}: {
  readonly selection: CustomerBookingSelection;
  readonly earlySetup: boolean;
  readonly locale: CustomerLocale;
}) {
  const overview = bookingOverviewOf(selection, earlySetup);
  return (
    <View style={styles.overview}>
      <Text role="heading" style={styles.product}>
        {productLabel(selection, locale)}
      </Text>
      {overviewRows(overview, locale).map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.value}>{row.value}</Text>
        </View>
      ))}
      {overview._tag === "MeetingRoom" && overview.earlySetup && (
        <Text style={styles.note}>
          {m.booking_checkout_overview_early_setup({}, { locale })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overview: {
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  product: { ...theme.type.heading, color: theme.colors.text },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: theme.spacing.md,
  },
  label: { ...theme.type.caption, color: theme.colors.textMuted },
  value: {
    ...theme.type.body,
    flexShrink: 1,
    textAlign: "right",
    color: theme.colors.text,
  },
  note: { ...theme.type.caption, color: theme.colors.textMuted },
});
