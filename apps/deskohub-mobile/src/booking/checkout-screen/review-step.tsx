import type {
  CustomerBookingSelection,
  CustomerLegalDocument,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import * as WebBrowser from "expo-web-browser";
import { Pressable, StyleSheet, View } from "react-native";
import { apiOrigin } from "../../auth/auth-client";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { ErrorState, LoadingState } from "../../ui/async-states";
import { Button, TextField } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import { Text } from "../../ui/text";
import type { CheckoutIntent } from "../checkout/checkout-flow";
import {
  CheckoutEvent,
  type ReviewNotice,
  type ReviewState,
} from "../checkout/checkout-state";
import { Checkbox } from "../ui/checkbox";
import { HoldCountdown } from "../ui/hold-countdown";
import { formatMoney } from "../ui/money";
import { PriceSummary } from "../ui/price-summary";
import { BookingOverviewView } from "./booking-overview-view";
import { retryMessage, summaryLineLabel } from "./checkout-copy";
import {
  type CodeFieldView,
  type ConsentView,
  type ReviewView,
  reviewView,
} from "./review-view";

type Send = (intent: CheckoutIntent) => void;
type Locale = { readonly locale: AppLocale };

/**
 * The held order before payment: what is booked and when, the hold
 * countdown, a changed price to accept, the itemized summary, the code field, the one legal checkbox, and
 * Pay, which only `canPay` enables.
 */
export function ReviewStep({
  review,
  now,
  selection,
  send,
  locale,
}: Locale & {
  readonly review: ReviewState;
  readonly now: number;
  readonly selection: CustomerBookingSelection;
  readonly send: Send;
}) {
  const view = reviewView(review, now);
  return (
    <View style={styles.step}>
      <BookingOverviewView
        selection={selection}
        earlySetup={review.flow.earlySetup === true}
        locale={locale}
      />
      <HoldCountdown secondsLeft={view.holdSecondsLeft} locale={locale} />
      <PriceReviewBanner view={view} send={send} locale={locale} />
      <PriceSummary
        summary={view.summary}
        lineLabel={summaryLineLabel(selection, locale)}
        locale={locale}
      />
      <CodeField code={view.code} send={send} locale={locale} />
      <LegalConsent consent={view.consent} send={send} locale={locale} />
      <ReviewNoticeView
        notice={review.notice}
        idle={Option.isNone(review.pending)}
        send={send}
        locale={locale}
      />
      <Button
        label={
          view.submitting
            ? m.booking_checkout_paying({}, { locale })
            : m.booking_checkout_pay(
                { amount: formatMoney(view.summary.total, locale) },
                { locale }
              )
        }
        onPress={() => send(CheckoutEvent.Pay())}
        disabled={!view.canPay}
      />
    </View>
  );
}

function PriceReviewBanner({
  view,
  send,
  locale,
}: Locale & { readonly view: ReviewView; readonly send: Send }) {
  return (
    <View style={styles.group}>
      <Notice
        tone="warning"
        message={
          view.priceReview
            ? m.booking_checkout_price_changed({}, { locale })
            : undefined
        }
      />
      {view.priceReview && (
        <Button
          label={
            view.acceptingPrice
              ? m.booking_checkout_accepting_price({}, { locale })
              : m.booking_checkout_accept_price({}, { locale })
          }
          onPress={() => send(CheckoutEvent.AcceptPrice())}
          disabled={view.busy}
        />
      )}
    </View>
  );
}

function CodeField({
  code,
  send,
  locale,
}: Locale & { readonly code: CodeFieldView; readonly send: Send }) {
  const message = codeMessageText(code, locale);
  return (
    <View style={styles.group}>
      <TextField
        label={m.booking_checkout_code_label({}, { locale })}
        value={code.input}
        onChangeText={(input) => send(CheckoutEvent.CodeChanged({ input }))}
        onSubmitEditing={() => send(CheckoutEvent.ApplyCode())}
        editable={code.editable}
      />
      <Button
        label={m.booking_checkout_code_apply({}, { locale })}
        onPress={() => send(CheckoutEvent.ApplyCode())}
        disabled={!code.canApply}
        variant="secondary"
      />
      <Text role="status" style={styles.caption}>
        {message ?? ""}
      </Text>
    </View>
  );
}

const codeMessageText = (
  code: CodeFieldView,
  locale: AppLocale
): string | undefined => {
  const { message } = code;
  switch (message._tag) {
    case "None":
      return undefined;
    case "Applying":
      return m.booking_checkout_code_applying({}, { locale });
    case "Applied":
      return message.outcome === "referral_accepted"
        ? m.booking_checkout_code_referral_applied({}, { locale })
        : m.booking_checkout_code_applied({}, { locale });
    case "AwaitingPriceAcceptance":
      return m.booking_checkout_code_awaiting_price({}, { locale });
    case "Retryable":
      return m.booking_checkout_code_unavailable({}, { locale });
    case "Rejected":
      return {
        already_attributed: () =>
          m.booking_checkout_code_already_attributed({}, { locale }),
        ineligible: () => m.booking_checkout_code_ineligible({}, { locale }),
        code_already_applied: () =>
          m.booking_checkout_code_already_applied({}, { locale }),
      }[message.reason]();
  }
};

const openDocument = (document: CustomerLegalDocument) => {
  void WebBrowser.openBrowserAsync(new URL(document.path, apiOrigin).href);
};

function LegalConsent({
  consent,
  send,
  locale,
}: Locale & { readonly consent: ConsentView; readonly send: Send }) {
  const { legal } = consent;
  switch (legal._tag) {
    case "Loading":
      return (
        <LoadingState
          label={m.booking_checkout_legal_loading({}, { locale })}
        />
      );
    case "Failed":
      return (
        <ErrorState
          message={m.booking_checkout_legal_failed({}, { locale })}
          retryLabel={m.booking_checkout_retry({}, { locale })}
          onRetry={() => send(CheckoutEvent.ReloadLegalDocuments())}
        />
      );
    case "Loaded":
      return (
        <Checkbox
          label={
            consent.earlyPerformance
              ? m.booking_checkout_legal_consent_early_performance(
                  {},
                  { locale }
                )
              : m.booking_checkout_legal_consent({}, { locale })
          }
          checked={consent.checked}
          onChange={(accepted) =>
            send(CheckoutEvent.ToggleConsent({ accepted }))
          }
          disabled={consent.disabled}
        >
          <View style={styles.links}>
            {legal.documents.map((document) => (
              <Pressable
                key={document.key}
                role="link"
                onPress={() => openDocument(document)}
                style={styles.link}
              >
                <Text style={styles.linkText}>
                  {{
                    "terms-and-conditions": () =>
                      m.booking_checkout_legal_terms({}, { locale }),
                    "operating-rules": () =>
                      m.booking_checkout_legal_operating_rules({}, { locale }),
                  }[document.key]()}
                </Text>
              </Pressable>
            ))}
          </View>
        </Checkbox>
      );
  }
}

function ReviewNoticeView({
  notice,
  idle,
  send,
  locale,
}: Locale & {
  readonly notice: Option.Option<ReviewNotice>;
  readonly idle: boolean;
  readonly send: Send;
}) {
  const shown = Option.getOrUndefined(notice);
  return (
    <View style={styles.group}>
      <Notice
        tone="error"
        message={shown && reviewNoticeMessage(shown, locale)}
      />
      {shown?._tag === "Retryable" && (
        <Button
          label={m.booking_checkout_retry({}, { locale })}
          onPress={() => send(CheckoutEvent.Retry())}
          disabled={!idle}
          variant="secondary"
        />
      )}
    </View>
  );
}

const reviewNoticeMessage = (notice: ReviewNotice, locale: AppLocale) => {
  switch (notice._tag) {
    case "Retryable":
      return retryMessage(notice.kind, locale);
    case "ConsentRequired":
      return notice.consent === "early_performance"
        ? m.booking_checkout_consent_required_early_performance({}, { locale })
        : m.booking_checkout_consent_required({}, { locale });
    case "LegalDocumentsChanged":
      return m.booking_checkout_legal_changed({}, { locale });
  }
};

const styles = StyleSheet.create({
  step: { gap: theme.spacing.lg },
  group: { gap: theme.spacing.sm },
  caption: { ...theme.type.caption, color: theme.colors.textMuted },
  links: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  link: { minHeight: theme.touchTarget, justifyContent: "center" },
  linkText: {
    ...theme.type.caption,
    color: theme.colors.accent,
    textDecorationLine: "underline",
  },
});
