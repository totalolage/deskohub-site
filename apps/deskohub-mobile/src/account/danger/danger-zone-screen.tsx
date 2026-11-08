import type { CustomerAccountState } from "@deskohub/workspace-customer-api";
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Effect, Match } from "effect";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  type ReauthenticationOutcome,
  useReauthentication,
} from "../../auth/reauthentication";
import {
  reauthenticationNotice,
  reauthenticationNoticeMessage,
} from "../../auth/reauthentication-notice";
import { signOut } from "../../auth/sign-out";
import { standaloneTaskRuntime } from "../../auth/use-auth-task";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { BodyText, Button, LiveMessage } from "../../ui/controls";
import { SectionHeader } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import {
  type DeletionAttempt,
  dangerZoneView,
  deletionAttemptOf,
  deletionFollowUp,
  deletionSubmittable,
  requestAccountDeletionAtom,
} from "./account-deletion";
import { ConfirmationCheckbox } from "./confirmation-checkbox";
import { deletedAccountExit } from "./deleted-account-exit";

// The global router: these screens unmount as the replace takes the
// signed-in routes away, and the exit outlives them.
const leaveDeletedAccountScreens = deletedAccountExit.leave({
  leave: Effect.sync(() => router.replace("/account-deleted")),
  signOut,
});

/** The sentence for an attempt's outcome, where the customer acts on it. */
const attemptMessage = (attempt: DeletionAttempt, locale: AppLocale) =>
  Match.value(attempt).pipe(
    Match.discriminatorsExhaustive("kind")({
      deleted: () => undefined,
      "reauthentication-required": () =>
        m.danger_reauthentication_required({}, { locale }),
      refused: () => m.danger_refused({}, { locale }),
      failed: () => m.danger_failed({}, { locale }),
      unconfirmed: () => m.danger_unconfirmed({}, { locale }),
      "request-failed": ({ error }) =>
        sharedViewErrorMessage(error, locale) ??
        m.danger_request_failed({}, { locale }),
    })
  );

/**
 * The danger zone: deleting the account (or retrying a pending deletion)
 * after an explicit confirmation and a final dialog. A deleted account
 * leaves for the deleted-account screen and signs out.
 */
export function DangerZoneScreen() {
  const locale = useAppLocale();
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  const requestDeletion = useAtomSet(requestAccountDeletionAtom, {
    mode: "promiseExit",
  });
  const reauthentication = useReauthentication();
  const [confirmed, setConfirmed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [attempt, setAttempt] = useState<DeletionAttempt>();
  const [reauthenticationOutcome, setReauthenticationOutcome] =
    useState<ReauthenticationOutcome>();

  // Held from the press through the request and any reauthentication, so a
  // second press before the next render sends nothing.
  const submitting = useRef(false);

  const reauthenticating = reauthentication.state.status === "running";
  const leaving = attempt?.kind === "deleted";
  // The last attempt's refetch decides whether the dialog may send again.
  const refetching = dialogOpen && account.waiting;
  const busy = requesting || leaving || reauthenticating || refetching;
  const submittable = deletionSubmittable(account, { confirmed, attempt });
  // The account no longer offers deletion (or couldn't be read) under the
  // open dialog: close it, and the screen shows what the account offers now.
  if (dialogOpen && !busy && !submittable) {
    setDialogOpen(false);
    setAttempt(undefined);
    setReauthenticationOutcome(undefined);
  }
  let busyMessage: string | undefined;
  if (requesting) busyMessage = m.danger_deleting({}, { locale });
  if (leaving) busyMessage = m.danger_signing_out({}, { locale });
  const shownIn =
    attempt === undefined ? undefined : deletionFollowUp(attempt).shownIn;
  const shownOnScreen =
    attempt !== undefined && shownIn === "screen"
      ? attemptMessage(attempt, locale)
      : undefined;
  const notice = reauthenticationNotice(
    reauthentication.state,
    reauthenticationOutcome
  );
  const reauthenticationFailure =
    notice?.kind === "failed"
      ? reauthenticationNoticeMessage(notice, locale)
      : undefined;
  const dialogFailure =
    reauthenticationFailure ??
    (attempt !== undefined && shownIn === "dialog"
      ? attemptMessage(attempt, locale)
      : undefined);

  const openDialog = () => {
    setAttempt(undefined);
    setReauthenticationOutcome(undefined);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (busy) return;
    setDialogOpen(false);
    setAttempt(undefined);
    setReauthenticationOutcome(undefined);
  };

  const confirm = async () => {
    if (submitting.current || busy || !submittable) return;
    submitting.current = true;
    setRequesting(true);
    setAttempt(undefined);
    setReauthenticationOutcome(undefined);
    const next = deletionAttemptOf(await requestDeletion(undefined));
    setRequesting(false);
    setAttempt(next);
    const followUp = deletionFollowUp(next);
    if (followUp.shownIn === "screen") setDialogOpen(false);
    if (followUp.next === "leave") {
      // Outside the account's registry, which ends with these screens. The
      // press guard stays held: the account is gone.
      standaloneTaskRuntime.runFork(leaveDeletedAccountScreens);
      return;
    }
    if (followUp.next === "reauthenticate") {
      const outcome = await reauthentication.reauthenticate();
      setReauthenticationOutcome(outcome);
      // Confirmed: the stale sign-in no longer applies; the customer presses
      // delete again.
      if (outcome === "reauthenticated") setAttempt(undefined);
    }
    submitting.current = false;
  };

  return (
    <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice
        tone={attempt?.kind === "refused" ? "error" : "warning"}
        message={shownOnScreen}
      />
      <AsyncView result={account} onRetry={refresh}>
        {(current) => (
          <DangerZoneContent
            account={current}
            confirmed={confirmed}
            attempt={attempt}
            locale={locale}
            onConfirmedChange={setConfirmed}
            onDelete={openDialog}
          />
        )}
      </AsyncView>
      <ConfirmDialog
        visible={dialogOpen}
        destructive
        title={m.danger_confirm_title({}, { locale })}
        body={m.danger_confirm_body({}, { locale })}
        confirmLabel={m.danger_confirm({}, { locale })}
        cancelLabel={m.danger_keep({}, { locale })}
        onConfirm={() => void confirm()}
        onCancel={closeDialog}
        busy={busy}
        busyMessage={busyMessage}
      >
        <LiveMessage
          role="status"
          message={
            notice !== undefined && notice.kind !== "failed"
              ? reauthenticationNoticeMessage(notice, locale)
              : undefined
          }
        />
        <LiveMessage role="alert" message={dialogFailure} />
      </ConfirmDialog>
    </ScrollScreen>
  );
}

function DangerZoneContent({
  account,
  confirmed,
  attempt,
  locale,
  onConfirmedChange,
  onDelete,
}: {
  readonly account: CustomerAccountState;
  readonly confirmed: boolean;
  readonly attempt: DeletionAttempt | undefined;
  readonly locale: AppLocale;
  readonly onConfirmedChange: (confirmed: boolean) => void;
  readonly onDelete: () => void;
}) {
  const view = dangerZoneView(account, { confirmed, attempt });
  if (view.deleteAction === "hidden") {
    return <BodyText>{m.danger_withheld({}, { locale })}</BodyText>;
  }
  const pending = view.offer === "pending";
  return (
    <View style={styles.zone}>
      <SectionHeader
        title={
          pending
            ? m.danger_pending_heading({}, { locale })
            : m.danger_heading({}, { locale })
        }
      />
      <BodyText>
        {pending
          ? m.danger_pending_description({}, { locale })
          : m.danger_description({}, { locale })}
      </BodyText>
      <ConfirmationCheckbox
        label={m.danger_confirm_label({}, { locale })}
        checked={confirmed}
        onChange={onConfirmedChange}
      />
      <Button
        variant="destructive"
        label={
          pending
            ? m.danger_retry_button({}, { locale })
            : m.danger_button({}, { locale })
        }
        disabled={view.deleteAction !== "enabled"}
        onPress={onDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { gap: theme.spacing.md },
});
