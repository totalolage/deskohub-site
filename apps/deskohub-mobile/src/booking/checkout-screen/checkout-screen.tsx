import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { Redirect, useIsFocused, useNavigation, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { LoadingState } from "../../ui/async-states";
import { Button } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import type { CheckoutRetryKind } from "../checkout/booking-problem";
import {
  type CheckoutController,
  type CheckoutRequest,
  checkoutRequestAtom,
  useCheckoutFlow,
} from "../checkout/checkout-flow";
import {
  CheckoutEvent,
  type CheckoutState,
  type DetailsState,
} from "../checkout/checkout-state";
import { retryMessage } from "./checkout-copy";
import { checkoutDestination, leaveCheckout } from "./checkout-navigation";
import {
  type DetailsDraft,
  detailsAccess,
  emptyDetailsDraft,
} from "./details-form";
import { DetailsStep } from "./details-step";
import { ReviewStep } from "./review-step";
import { useCheckoutNavigation } from "./use-checkout-navigation";

/**
 * `/book/checkout`: the checkout a family screen asked for. Without one
 * (such as after a web reload) it returns to the booking start.
 */
export function CheckoutScreen() {
  const request = useAtomValue(checkoutRequestAtom);
  return Option.match(request, {
    onNone: () => <Redirect href="/book" />,
    onSome: (current) => <CheckoutFlowScreen request={current} />,
  });
}

function CheckoutFlowScreen({
  request,
}: {
  readonly request: CheckoutRequest;
}) {
  const locale = useAppLocale();
  // Blurred, the flow holds the payment page until the screen is back (R8).
  const focused = useIsFocused();
  const navigation = useNavigation();
  const flow = useCheckoutFlow(request, {
    focused,
    isFocused: () => navigation.isFocused(),
  });
  const family = request.selection.family;
  useCheckoutNavigation(flow.view, family);
  // Lifted so the form survives Details -> Creating -> Details.
  const [draft, setDraft] = useState<DetailsDraft>(emptyDetailsDraft);
  return (
    <ScrollScreen>
      {flow.view._tag === "Starting" ? (
        <LoadingState label={m.booking_checkout_starting({}, { locale })} />
      ) : (
        <CheckoutStateView
          state={flow.view.state}
          now={flow.view.now}
          flow={flow}
          request={request}
          draft={draft}
          onDraftChange={setDraft}
          locale={locale}
        />
      )}
    </ScrollScreen>
  );
}

function CheckoutStateView({
  state,
  now,
  flow,
  request,
  draft,
  onDraftChange,
  locale,
}: {
  readonly state: CheckoutState;
  readonly now: number;
  readonly flow: CheckoutController;
  readonly request: CheckoutRequest;
  readonly draft: DetailsDraft;
  readonly onDraftChange: (draft: DetailsDraft) => void;
  readonly locale: AppLocale;
}) {
  const retry = () => flow.send(CheckoutEvent.Retry());
  switch (state._tag) {
    case "Details":
    case "Creating":
      return (
        <DetailsForAccount
          notice={state._tag === "Details" ? state.notice : Option.none()}
          busy={state._tag === "Creating"}
          flow={flow}
          draft={draft}
          onDraftChange={onDraftChange}
          locale={locale}
        />
      );
    case "Review":
      return (
        <ReviewStep
          review={state}
          now={now}
          selection={request.selection}
          send={flow.send}
          locale={locale}
        />
      );
    case "Uncertain":
      return (
        <StatusNotice
          tone="warning"
          message={m.booking_checkout_unconfirmed({}, { locale })}
          detail={state.notice}
          action={{
            label: m.booking_checkout_retry({}, { locale }),
            onPress: retry,
            disabled: state.retrying,
          }}
          locale={locale}
        />
      );
    case "Paying":
      // A payment page held while the screen was out of view opens as soon
      // as it's back, so this notice is all the held state needs.
      return (
        <StatusNotice
          tone="info"
          message={m.booking_checkout_payment_open({}, { locale })}
          detail={state.notice}
          action={
            Option.isSome(state.notice) && Option.isNone(state.opening)
              ? {
                  label: m.booking_checkout_payment_reopen({}, { locale }),
                  onPress: retry,
                  disabled: false,
                }
              : undefined
          }
          locale={locale}
        />
      );
    case "Done":
    case "Restart":
      return <FinishedNotice state={state} request={request} locale={locale} />;
    case "Blocked":
      return <BlockedNotice reason={state.reason} locale={locale} />;
  }
}

function DetailsForAccount({
  notice,
  busy,
  flow,
  draft,
  onDraftChange,
  locale,
}: {
  readonly notice: DetailsState["notice"];
  readonly busy: boolean;
  readonly flow: CheckoutController;
  readonly draft: DetailsDraft;
  readonly onDraftChange: (draft: DetailsDraft) => void;
  readonly locale: AppLocale;
}) {
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  return (
    <AsyncView result={account} onRetry={refresh}>
      {(current) => {
        const access = detailsAccess(current);
        if (access._tag === "Unavailable") {
          return (
            <AccountUnavailableNotice reason={access.reason} locale={locale} />
          );
        }
        return (
          <DetailsStep
            self={access.self}
            draft={draft}
            onDraftChange={onDraftChange}
            notice={notice}
            busy={busy}
            onContinue={flow.continueWith}
            onRetry={() => flow.send(CheckoutEvent.Retry())}
            locale={locale}
          />
        );
      }}
    </AsyncView>
  );
}

interface NoticeAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled: boolean;
}

function StatusNotice({
  tone,
  message,
  detail,
  action,
  locale,
}: {
  readonly tone: "info" | "warning" | "error";
  readonly message: string;
  /** Why the last attempt failed, below the message. */
  readonly detail?: Option.Option<CheckoutRetryKind>;
  readonly action?: NoticeAction;
  readonly locale: AppLocale;
}) {
  const detailKind =
    detail === undefined ? undefined : Option.getOrUndefined(detail);
  return (
    <View style={styles.group}>
      <Notice tone={tone} message={message} />
      <Notice
        tone="error"
        message={detailKind && retryMessage(detailKind, locale)}
      />
      {action !== undefined && (
        <Button
          label={action.label}
          onPress={action.onPress}
          disabled={action.disabled}
        />
      )}
    </View>
  );
}

/**
 * A finished checkout normally leaves at once; this shows only when it
 * finished while the customer was elsewhere (R8), so they can go on.
 */
function FinishedNotice({
  state,
  request,
  locale,
}: {
  readonly state: Extract<CheckoutState, { readonly _tag: "Done" | "Restart" }>;
  readonly request: CheckoutRequest;
  readonly locale: AppLocale;
}) {
  const router = useRouter();
  const destination = checkoutDestination(
    { _tag: "Running", state, now: 0 },
    request.selection.family
  );
  const done = state._tag === "Done";
  return (
    <StatusNotice
      tone="info"
      message={
        done
          ? m.booking_checkout_done({}, { locale })
          : m.booking_checkout_restart({}, { locale })
      }
      action={
        destination === undefined
          ? undefined
          : {
              label: done
                ? m.booking_checkout_show_status({}, { locale })
                : m.booking_checkout_back_to_booking({}, { locale }),
              onPress: () => leaveCheckout(router, destination),
              disabled: false,
            }
      }
      locale={locale}
    />
  );
}

function BlockedNotice({
  reason,
  locale,
}: {
  readonly reason: Extract<
    CheckoutState,
    { readonly _tag: "Blocked" }
  >["reason"];
  readonly locale: AppLocale;
}) {
  const router = useRouter();
  if (reason === "profile-missing") {
    return (
      <StatusNotice
        tone="warning"
        message={m.booking_checkout_blocked_profile_missing({}, { locale })}
        action={{
          label: m.booking_checkout_complete_profile({}, { locale }),
          onPress: () => router.push("/account/complete"),
          disabled: false,
        }}
        locale={locale}
      />
    );
  }
  return (
    <StatusNotice
      tone="warning"
      message={{
        "support-required": () =>
          m.booking_checkout_blocked_support_required({}, { locale }),
        "deletion-pending": () =>
          m.booking_checkout_blocked_deletion_pending({}, { locale }),
        "payment-disabled": () =>
          m.booking_checkout_blocked_payment_disabled({}, { locale }),
      }[reason]()}
      locale={locale}
    />
  );
}

function AccountUnavailableNotice({
  reason,
  locale,
}: {
  readonly reason:
    | "support-required"
    | "deletion-pending"
    | "authenticated-unavailable";
  readonly locale: AppLocale;
}) {
  return (
    <StatusNotice
      tone="warning"
      message={{
        "support-required": () =>
          m.booking_checkout_blocked_support_required({}, { locale }),
        "deletion-pending": () =>
          m.booking_checkout_blocked_deletion_pending({}, { locale }),
        "authenticated-unavailable": () =>
          m.booking_checkout_blocked_account_unavailable({}, { locale }),
      }[reason]()}
      locale={locale}
    />
  );
}

const styles = StyleSheet.create({
  group: { gap: theme.spacing.md },
});
