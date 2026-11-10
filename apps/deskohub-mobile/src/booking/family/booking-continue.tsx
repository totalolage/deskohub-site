import type { CustomerBookingQuote } from "@deskohub/workspace-customer-api";
import { useAtomSet } from "@effect/atom-react";
import { Option } from "effect";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { Button } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import { Text } from "../../ui/text";
import { bookCheckoutHref } from "../booking-routes";
import {
  type CheckoutRequest,
  checkoutRequestAtom,
} from "../checkout/checkout-flow";
import { formatMoney } from "../ui/money";
import { bookingQueryMessage } from "./booking-family-copy";
import {
  type BookingRead,
  isRetryableBookingQueryError,
} from "./booking-family-view";

/**
 * The selection's quoted total and Continue, which opens checkout with the
 * selection and its quote. Continue stays disabled until the selection is
 * complete, available and quoted.
 */
export function BookingContinue({
  quote,
  checkout,
  onRetryQuote,
  quoteFailureShown,
}: {
  /** None while there is nothing to quote. */
  readonly quote: Option.Option<BookingRead<CustomerBookingQuote>>;
  readonly checkout: Option.Option<CheckoutRequest>;
  readonly onRetryQuote: () => void;
  /** False while the screen already shows the same failure above. */
  readonly quoteFailureShown: boolean;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const setCheckoutRequest = useAtomSet(checkoutRequestAtom);
  const read = Option.getOrUndefined(quote);
  const failed =
    quoteFailureShown && read?.kind === "failed" ? read : undefined;
  return (
    <View style={styles.container}>
      {/* Kept mounted so assistive tech announces each change. */}
      <Text role="status" style={styles.total}>
        {read?.kind === "loading" && m.booking_quote_loading({}, { locale })}
        {read?.kind === "loaded" &&
          m.booking_quote_total(
            { total: formatMoney(read.value.total, locale) },
            { locale }
          )}
      </Text>
      <Notice
        tone="error"
        message={
          failed === undefined
            ? undefined
            : bookingQueryMessage(failed.error, locale)
        }
      />
      {failed !== undefined && isRetryableBookingQueryError(failed.error) && (
        <Button
          variant="secondary"
          label={m.account_retry({}, { locale })}
          disabled={failed.retrying}
          onPress={onRetryQuote}
        />
      )}
      <Button
        label={m.booking_continue({}, { locale })}
        disabled={Option.isNone(checkout)}
        onPress={() =>
          Option.map(checkout, (request) => {
            setCheckoutRequest(Option.some(request));
            router.push(bookCheckoutHref);
          })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing.sm, paddingVertical: theme.spacing.md },
  total: { ...theme.type.heading, color: theme.colors.text },
});
