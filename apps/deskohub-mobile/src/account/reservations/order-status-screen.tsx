import type {
  CustomerOrderFulfillmentStatus,
  CustomerOrderPaymentStatus,
  CustomerOrderStatus,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Match, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant, parseInstant } from "../../i18n/date-time-format";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { formatMoney } from "../../i18n/money-format";
import { theme } from "../../theme";
import { Button, LiveMessage } from "../../ui/controls";
import { ListGroup, ListRow } from "../../ui/list";
import { useLiveRegionAnnouncement } from "../../ui/live-announcement";
import { LoadingIndicator } from "../../ui/loading-indicator";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import { bookingEntryEnabled } from "./booking-entry";
import {
  InvoiceShareFailure,
  invoiceShareAtom,
  invoiceShareFailureOf,
} from "./invoice-share";
import {
  offersAccessLink,
  offersInvoice,
  orderStatusTraits,
} from "./order-status-kind";
import { focusGained, focusLost, orderStatusAtoms } from "./order-status-state";
import { reservationKindTitle } from "./reservation-labels";
import { reservationPeriodText } from "./reservation-period";
import { canRefreshManually, type StatusRefreshState } from "./status-refresh";
import { AutomaticRefresh, type StatusVisit } from "./status-refresh-rules";

const statusCopy = (status: CustomerOrderStatus, locale: AppLocale) =>
  ({
    created: () => ({
      title: m.reservations_order_created_title({}, { locale }),
      body: m.reservations_order_created_body({}, { locale }),
    }),
    pending: () => ({
      title: m.reservations_order_pending_title({}, { locale }),
      body: m.reservations_order_pending_body({}, { locale }),
    }),
    payment_pending_delayed: () => ({
      title: m.reservations_order_payment_pending_delayed_title({}, { locale }),
      body: m.reservations_order_payment_pending_delayed_body({}, { locale }),
    }),
    paid_waiting_fulfillment: () => ({
      title: m.reservations_order_paid_waiting_fulfillment_title(
        {},
        { locale }
      ),
      body: m.reservations_order_paid_waiting_fulfillment_body({}, { locale }),
    }),
    paid_fulfillment_delayed: () => ({
      title: m.reservations_order_paid_fulfillment_delayed_title(
        {},
        { locale }
      ),
      body: m.reservations_order_paid_fulfillment_delayed_body({}, { locale }),
    }),
    paid_awaiting_delivery: () => ({
      title: m.reservations_order_paid_awaiting_delivery_title({}, { locale }),
      body: m.reservations_order_paid_awaiting_delivery_body({}, { locale }),
    }),
    paid_delivery_delayed: () => ({
      title: m.reservations_order_paid_delivery_delayed_title({}, { locale }),
      body: m.reservations_order_paid_delivery_delayed_body({}, { locale }),
    }),
    fulfilled: () => ({
      title: m.reservations_order_fulfilled_title({}, { locale }),
      body: m.reservations_order_fulfilled_body({}, { locale }),
    }),
    fulfillment_failed: () => ({
      title: m.reservations_order_fulfillment_failed_title({}, { locale }),
      body: m.reservations_order_fulfillment_failed_body({}, { locale }),
    }),
    payment_failed: () => ({
      title: m.reservations_order_payment_failed_title({}, { locale }),
      body: m.reservations_order_payment_failed_body({}, { locale }),
    }),
    cancelled: () => ({
      title: m.reservations_order_cancelled_title({}, { locale }),
      body: m.reservations_order_cancelled_body({}, { locale }),
    }),
    expired: () => ({
      title: m.reservations_order_expired_title({}, { locale }),
      body: m.reservations_order_expired_body({}, { locale }),
    }),
    late_payment_checking: () => ({
      title: m.reservations_order_late_payment_checking_title({}, { locale }),
      body: m.reservations_order_late_payment_checking_body({}, { locale }),
    }),
    late_payment_refund: () => ({
      title: m.reservations_order_late_payment_refund_title({}, { locale }),
      body: m.reservations_order_late_payment_refund_body({}, { locale }),
    }),
    late_payment_review: () => ({
      title: m.reservations_order_late_payment_review_title({}, { locale }),
      body: m.reservations_order_late_payment_review_body({}, { locale }),
    }),
  })[status]();

const paymentLabel = (status: CustomerOrderPaymentStatus, locale: AppLocale) =>
  ({
    not_started: () => m.reservations_order_payment_not_started({}, { locale }),
    pending: () => m.reservations_order_payment_pending({}, { locale }),
    paid: () => m.reservations_order_payment_paid({}, { locale }),
    failed: () => m.reservations_order_payment_failed({}, { locale }),
    cancelled: () => m.reservations_order_payment_cancelled({}, { locale }),
    expired: () => m.reservations_order_payment_expired({}, { locale }),
  })[status]();

const confirmationLabel = (
  status: CustomerOrderFulfillmentStatus,
  locale: AppLocale
) =>
  ({
    not_started: () =>
      m.reservations_order_confirmation_not_started({}, { locale }),
    processing: () =>
      m.reservations_order_confirmation_processing({}, { locale }),
    awaiting_delivery: () =>
      m.reservations_order_confirmation_awaiting_delivery({}, { locale }),
    fulfilled: () =>
      m.reservations_order_confirmation_fulfilled({}, { locale }),
    failed: () => m.reservations_order_confirmation_failed({}, { locale }),
  })[status]();

const statusErrorMessage =
  (locale: AppLocale) =>
  (error: CustomerViewError): string | undefined =>
    CustomerViewError.$is("NotFound")(error)
      ? m.reservations_order_not_found({}, { locale })
      : undefined;

/** What the screen says about refreshing, besides a failed read. */
const refreshNote = (state: StatusRefreshState, locale: AppLocale) =>
  state.reading
    ? m.reservations_refresh_reading({}, { locale })
    : AutomaticRefresh.$match(state.automatic, {
        After: () => m.reservations_refresh_scheduled({}, { locale }),
        Stopped: ({ reason }) =>
          Match.value(reason).pipe(
            Match.when("budget", () =>
              m.reservations_refresh_paused({}, { locale })
            ),
            Match.when("exhausted", () =>
              m.reservations_refresh_ended({}, { locale })
            ),
            // A settled order needs no note; a failed read has its notice.
            Match.orElse(() => undefined)
          ),
      });

const invoiceFailureMessage = (
  failure: InvoiceShareFailure,
  locale: AppLocale
) =>
  InvoiceShareFailure.$match(failure, {
    Share: () => m.reservations_invoice_share_failed({}, { locale }),
    Download: ({ error }) =>
      Match.value(error).pipe(
        Match.tag("InvoiceNotIssued", () =>
          m.reservations_invoice_not_issued({}, { locale })
        ),
        Match.tag("NotFound", () =>
          m.reservations_invoice_not_found({}, { locale })
        ),
        Match.orElse(
          (other) =>
            sharedViewErrorMessage(other, locale) ??
            m.account_error_unexpected({}, { locale })
        )
      ),
  });

function InvoiceAction({
  orderId,
}: {
  readonly orderId: CustomerReservationOrderId;
}) {
  const locale = useAppLocale();
  const result = useAtomValue(invoiceShareAtom(orderId));
  const share = useAtomSet(invoiceShareAtom(orderId));
  const failure = AsyncResult.isFailure(result)
    ? invoiceShareFailureOf(result.cause)
    : undefined;
  return (
    <>
      <ListGroup>
        <ListRow
          kind="action"
          label={m.reservations_invoice_action({}, { locale })}
          disabled={result.waiting}
          onPress={() => share()}
        />
      </ListGroup>
      <LiveMessage
        role="status"
        message={
          result.waiting
            ? m.reservations_invoice_preparing({}, { locale })
            : undefined
        }
      />
      <LiveMessage
        role="alert"
        message={
          failure === undefined
            ? undefined
            : invoiceFailureMessage(failure, locale)
        }
      />
    </>
  );
}

function OrderStatusContent({
  state,
  onRefresh,
}: {
  readonly state: StatusRefreshState;
  readonly onRefresh: () => void;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  const { order } = state;
  const copy = statusCopy(order.status, locale);
  const tone = orderStatusTraits[order.status].tone;
  // The status changes while the screen is open: announce the new one.
  useLiveRegionAnnouncement(copy.title, "polite");
  // The last read's own failure; a 429 reads as "temporarily limited".
  const failureMessage = Option.getOrUndefined(
    Option.map(
      state.failure,
      (failure) =>
        statusErrorMessage(locale)(failure) ??
        sharedViewErrorMessage(failure, locale) ??
        m.account_error_unexpected({}, { locale })
    )
  );
  const setupStartsAt = Option.flatMap(
    Option.fromUndefinedOr(order.setupStartsAt),
    parseInstant
  );

  return (
    <>
      <View
        style={[styles.status, { borderColor: toneColor[tone] }]}
        aria-live="polite"
      >
        <Text role="heading" style={styles.statusTitle}>
          {copy.title}
        </Text>
        <Text style={styles.statusBody}>{copy.body}</Text>
      </View>
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice tone="warning" message={failureMessage} />
      <LiveMessage role="status" message={refreshNote(state, locale)} />
      <View style={styles.refresh}>
        <Button
          variant="secondary"
          label={m.reservations_refresh({}, { locale })}
          disabled={!canRefreshManually(state)}
          onPress={onRefresh}
        />
      </View>

      <ListGroup>
        <ListRow
          label={m.reservations_order_space({}, { locale })}
          value={reservationKindTitle(order.kind, locale)}
        />
        <ListRow
          label={m.reservations_order_when({}, { locale })}
          value={reservationPeriodText(order, locale)}
          wrapValue
        />
        {Option.isSome(setupStartsAt) && (
          <ListRow
            label={m.reservations_setup_from(
              { time: formatInstant(setupStartsAt.value, locale, "time") },
              { locale }
            )}
          />
        )}
        <ListRow
          label={m.reservations_order_total({}, { locale })}
          value={
            order.total === undefined
              ? m.reservations_value_unavailable({}, { locale })
              : formatMoney(order.total, locale)
          }
        />
        <ListRow
          label={m.reservations_order_payment({}, { locale })}
          value={paymentLabel(order.paymentStatus, locale)}
        />
        <ListRow
          label={m.reservations_order_confirmation({}, { locale })}
          value={confirmationLabel(order.fulfillmentStatus, locale)}
        />
      </ListGroup>

      {offersAccessLink(order) && (
        <ListGroup>
          <ListRow
            label={m.reservations_order_access({}, { locale })}
            onPress={() =>
              router.push(
                `/reservations/${encodeURIComponent(order.orderId)}/access` as Href
              )
            }
          />
        </ListGroup>
      )}
      {offersInvoice(order) && <InvoiceAction orderId={order.orderId} />}
      {bookingEntryEnabled &&
        orderStatusTraits[order.status].offersNewReservation && (
          <ListGroup>
            <ListRow
              label={m.reservations_book({}, { locale })}
              onPress={() => router.push("/book" as Href)}
            />
          </ListGroup>
        )}
    </>
  );
}

/**
 * The status card while the first read is under way. That read refreshes the
 * order with the payment gateway and takes a moment, notably right after the
 * return from payment; a lone spinner on the empty screen read as blank.
 */
function OrderStatusPending() {
  const locale = useAppLocale();
  return (
    <View
      style={[styles.status, styles.pending, { borderColor: toneColor.info }]}
    >
      <LoadingIndicator
        size="section"
        tone="brand"
        label={m.account_loading({}, { locale })}
      />
      <Text role="heading" style={styles.pendingTitle}>
        {m.reservations_refresh_reading({}, { locale })}
      </Text>
    </View>
  );
}

/**
 * An order's status (GET status, which refreshes the order and spends the
 * read budget): what happens next, the order summary, and its actions. It
 * keeps itself up to date while focused and in the foreground.
 */
export function OrderStatusScreen({
  orderId,
  visit,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly visit: StatusVisit;
}) {
  const locale = useAppLocale();
  const result = useAtomValue(orderStatusAtoms.status(orderId));
  const retry = useAtomRefresh(orderStatusAtoms.progress(orderId));
  const setFocus = useAtomSet(orderStatusAtoms.focus(orderId));
  const tap = useAtomSet(orderStatusAtoms.refreshRequests(orderId));

  useFocusEffect(
    useCallback(() => {
      setFocus(focusGained(visit));
      return () => setFocus(focusLost);
    }, [setFocus, visit])
  );

  // After a failed first read the refreshes have ended: start them again.
  const refresh = AsyncResult.isFailure(result)
    ? retry
    : () => tap((taps) => taps + 1);
  const refreshable = Option.match(AsyncResult.value(result), {
    onNone: () => false,
    onSome: canRefreshManually,
  });

  return (
    <ScrollScreen
      refreshing={result.waiting}
      onRefresh={refreshable ? refresh : undefined}
    >
      <AsyncView
        result={result}
        onRetry={retry}
        errorMessage={statusErrorMessage(locale)}
        loading={<OrderStatusPending />}
      >
        {(state) => <OrderStatusContent state={state} onRefresh={refresh} />}
      </AsyncView>
    </ScrollScreen>
  );
}

const toneColor = {
  info: theme.colors.info,
  warning: theme.colors.warning,
  error: theme.colors.danger,
} as const;

const styles = StyleSheet.create({
  status: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderLeftWidth: 4,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
  },
  statusTitle: { ...theme.type.heading, color: theme.colors.text },
  statusBody: { ...theme.type.body, color: theme.colors.textMuted },
  pending: { flexDirection: "row", alignItems: "center" },
  pendingTitle: { ...theme.type.heading, color: theme.colors.text, flex: 1 },
  refresh: { alignItems: "flex-start" },
});
