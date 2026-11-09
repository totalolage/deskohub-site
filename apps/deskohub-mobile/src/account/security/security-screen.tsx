import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Match, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useReducer } from "react";
import { StyleSheet, View } from "react-native";
import { AddPasskeyAction } from "../../auth/passkey/add-passkey-action";
import { useReauthentication } from "../../auth/reauthentication";
import { reauthenticationNoticeMessage } from "../../auth/reauthentication-notice";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant } from "../../i18n/date-time-format";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { BodyText, Button, LiveMessage, TextField } from "../../ui/controls";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import {
  deletePasskeyAtom,
  type PasskeyRow,
  passkeyNameMaximumLength,
  passkeyRow,
  passkeysAtom,
  passkeysReleased,
  passkeyWriteOutcome,
  renamePasskeyAtom,
} from "./passkeys";
import {
  initialSecurityScreenState,
  type PasskeyDialogFailure,
  reauthenticationPrompt,
  renameSubmission,
  renameValidation,
  type SecurityAnnouncement,
  SecurityScreenEvent,
  securityScreenReducer,
  shownPasskeyName,
} from "./security-screen-state";

const passkeyDetails = (row: PasskeyRow, locale: AppLocale) =>
  Option.getOrUndefined(
    Option.map(row.createdAt, (createdAt) => {
      const date = formatInstant(createdAt, locale, "date");
      return row.provider === undefined
        ? m.security_passkey_created_on({ date }, { locale })
        : m.security_passkey_details(
            { provider: row.provider, date },
            { locale }
          );
    })
  ) ?? row.provider;

const passkeysErrorMessage =
  (locale: AppLocale) => (error: CustomerViewError) =>
    Match.value(error).pipe(
      Match.tags({
        Unavailable: () => m.security_passkeys_unavailable({}, { locale }),
        TimedOut: () => m.security_passkeys_unavailable({}, { locale }),
      }),
      Match.orElse(() => undefined)
    );

const announcementMessage = (
  announcement: SecurityAnnouncement | undefined,
  locale: AppLocale
) =>
  announcement === undefined
    ? undefined
    : {
        renamed: m.security_renamed,
        deleted: m.security_deleted,
        gone: m.security_passkey_gone,
        adding: m.passkey_add_pending,
      }[announcement]({}, { locale });

const dialogFailureMessage = ({
  failure,
  kind,
  reauthenticationRequired,
  locale,
}: {
  readonly failure: PasskeyDialogFailure | undefined;
  readonly kind: "rename" | "delete";
  readonly reauthenticationRequired: boolean;
  readonly locale: AppLocale;
}) =>
  failure === undefined
    ? undefined
    : {
        "reauthentication-required": () =>
          reauthenticationRequired
            ? m.security_reauthentication_required({}, { locale })
            : undefined,
        unconfirmed: () => m.account_save_unconfirmed({}, { locale }),
        failed: () =>
          ({
            rename: m.security_rename_failed,
            delete: m.security_delete_failed,
          })[kind]({}, { locale }),
      }[failure]();

/**
 * Sign-in & security: email sign-in, which always works, and the account's
 * passkeys (hidden while the release withholds them), which the customer can
 * add, rename and delete.
 */
export function SecurityScreen() {
  const locale = useAppLocale();
  const account = useAtomValue(accountAtom);
  const refreshAccount = useAtomRefresh(accountAtom);
  const passkeys = useAtomValue(passkeysAtom);
  const refreshPasskeys = useAtomRefresh(passkeysAtom);
  const renaming = useAtomValue(renamePasskeyAtom).waiting;
  const deleting = useAtomValue(deletePasskeyAtom).waiting;
  const rename = useAtomSet(renamePasskeyAtom, { mode: "promiseExit" });
  const remove = useAtomSet(deletePasskeyAtom, { mode: "promiseExit" });
  const { state: reauthenticationTask, reauthenticate } = useReauthentication();
  const [state, dispatch] = useReducer(
    securityScreenReducer,
    initialSecurityScreenState
  );

  const prompt = reauthenticationPrompt(
    state.reauthentication,
    reauthenticationTask
  );
  const promptProgress =
    prompt.notice === undefined
      ? undefined
      : reauthenticationNoticeMessage(prompt.notice, locale);
  const dialog = state.dialog;
  const defaultName = m.security_passkey_default_name({}, { locale });
  const rows = Option.getOrUndefined(
    Option.map(AsyncResult.value(passkeys), (list) =>
      list.map((passkey) => passkeyRow(passkey, defaultName))
    )
  );

  const confirmItsYou = async () => {
    const outcome = await reauthenticate();
    dispatch(SecurityScreenEvent.ReauthenticationEnded({ outcome }));
  };

  const runWrite = async (
    write: () => Promise<Parameters<typeof passkeyWriteOutcome>[0]>
  ) => {
    dispatch(SecurityScreenEvent.WriteStarted());
    const outcome = passkeyWriteOutcome(await write());
    dispatch(SecurityScreenEvent.WriteEnded({ outcome }));
    if (outcome === "reauthentication-required") await confirmItsYou();
  };

  const saveName = () => {
    if (dialog === undefined) return;
    const shownName = shownPasskeyName(dialog, rows);
    const submission = renameSubmission(dialog, shownName);
    dispatch(SecurityScreenEvent.RenameSubmitted({ shownName }));
    if (submission._tag === "Save") {
      void runWrite(() => rename({ id: submission.id, name: submission.name }));
    }
  };

  const validation = renameValidation(dialog);
  const validationMessage =
    validation === undefined
      ? undefined
      : {
          Required: () => m.security_rename_required({}, { locale }),
          TooLong: () =>
            m.security_rename_maximum(
              { max: passkeyNameMaximumLength },
              { locale }
            ),
        }[validation._tag]();
  const dialogFailure =
    dialog === undefined
      ? undefined
      : dialogFailureMessage({
          failure: dialog.failure,
          kind: dialog.kind,
          reauthenticationRequired: prompt.required,
          locale,
        });

  return (
    <ScrollScreen refreshing={passkeys.waiting} onRefresh={refreshPasskeys}>
      <AsyncView result={account} onRetry={refreshAccount}>
        {(current) => (
          <ListGroup>
            <ListRow
              label={m.security_email_title({}, { locale })}
              description={m.security_email_body(
                { email: current.email },
                { locale }
              )}
              value={m.security_email_badge({}, { locale })}
            />
          </ListGroup>
        )}
      </AsyncView>
      {passkeysReleased(passkeys) && (
        <>
          <SectionHeader title={m.security_passkeys_title({}, { locale })} />
          <BodyText>{m.security_passkeys_intro({}, { locale })}</BodyText>
          <AsyncView
            result={passkeys}
            onRetry={refreshPasskeys}
            errorMessage={passkeysErrorMessage(locale)}
          >
            {(list) => {
              const listed = list.map((passkey) =>
                passkeyRow(passkey, defaultName)
              );
              return (
                <>
                  {listed.length === 0 && (
                    <ListGroup>
                      <ListRow
                        label={m.security_passkeys_empty({}, { locale })}
                      />
                    </ListGroup>
                  )}
                  {listed.map((row) => (
                    <ListGroup key={row.id}>
                      <ListRow
                        label={row.name}
                        description={passkeyDetails(row, locale)}
                      />
                      <View style={styles.actions}>
                        <View style={styles.action}>
                          <Button
                            variant="secondary"
                            label={m.security_passkey_rename({}, { locale })}
                            disabled={state.adding}
                            accessibilityLabel={m.security_passkey_rename_label(
                              { name: row.name },
                              { locale }
                            )}
                            onPress={() =>
                              dispatch(
                                SecurityScreenEvent.RenameOpened({
                                  passkey: row,
                                })
                              )
                            }
                          />
                        </View>
                        <View style={styles.action}>
                          <Button
                            variant="secondary"
                            label={m.security_passkey_delete({}, { locale })}
                            disabled={state.adding}
                            accessibilityLabel={m.security_passkey_delete_label(
                              { name: row.name },
                              { locale }
                            )}
                            onPress={() =>
                              dispatch(
                                SecurityScreenEvent.DeleteOpened({
                                  passkey: row,
                                  passkeyCount: listed.length,
                                })
                              )
                            }
                          />
                        </View>
                      </View>
                    </ListGroup>
                  ))}
                  <AddPasskeyAction
                    onStart={() =>
                      dispatch(SecurityScreenEvent.PasskeyAddStarted())
                    }
                    onSettled={() =>
                      dispatch(SecurityScreenEvent.PasskeyAddSettled())
                    }
                    onAdded={() => {
                      dispatch(SecurityScreenEvent.PasskeyAdded());
                      refreshPasskeys();
                    }}
                    onReauthenticationRequired={() => {
                      dispatch(
                        SecurityScreenEvent.AddReauthenticationRequired()
                      );
                      void confirmItsYou();
                    }}
                  />
                </>
              );
            }}
          </AsyncView>
        </>
      )}
      {/* Kept mounted so assistive tech announces each change; an open
          dialog speaks for itself. */}
      <LiveMessage
        role="status"
        message={announcementMessage(state.announcement, locale)}
      />
      <LiveMessage
        role="alert"
        message={
          dialog === undefined && prompt.required
            ? m.security_reauthentication_required({}, { locale })
            : undefined
        }
      />
      <LiveMessage
        role="status"
        message={dialog === undefined ? promptProgress : undefined}
      />
      <ConfirmDialog
        visible={dialog?.kind === "rename"}
        title={m.security_rename_title({}, { locale })}
        body={m.security_rename_body({}, { locale })}
        confirmLabel={m.security_rename_save({}, { locale })}
        cancelLabel={m.account_cancel({}, { locale })}
        onConfirm={saveName}
        onCancel={() => dispatch(SecurityScreenEvent.DialogCancelled())}
        busy={renaming}
        busyMessage={m.security_rename_saving({}, { locale })}
      >
        <TextField
          label={m.security_rename_name_label({}, { locale })}
          value={dialog?.kind === "rename" ? dialog.draft : ""}
          onChangeText={(draft) =>
            dispatch(SecurityScreenEvent.DraftChanged({ draft }))
          }
          onSubmitEditing={saveName}
          editable={!renaming}
          autoFocus
        />
        <LiveMessage
          role="alert"
          message={
            dialog?.kind === "rename"
              ? (validationMessage ?? dialogFailure)
              : undefined
          }
        />
        <LiveMessage
          role="status"
          message={dialog?.kind === "rename" ? promptProgress : undefined}
        />
      </ConfirmDialog>
      <ConfirmDialog
        visible={dialog?.kind === "delete"}
        title={m.security_delete_title(
          { name: dialog?.passkey.name ?? "" },
          { locale }
        )}
        body={m.security_delete_body({}, { locale })}
        confirmLabel={m.security_delete_confirm({}, { locale })}
        cancelLabel={m.account_cancel({}, { locale })}
        onConfirm={() => {
          if (dialog?.kind !== "delete") return;
          const id = dialog.passkey.id;
          void runWrite(() => remove(id));
        }}
        onCancel={() => dispatch(SecurityScreenEvent.DialogCancelled())}
        destructive
        busy={deleting}
        busyMessage={m.security_deleting({}, { locale })}
      >
        {dialog?.kind === "delete" && dialog.last && (
          <BodyText>{m.security_delete_last_body({}, { locale })}</BodyText>
        )}
        <LiveMessage
          role="alert"
          message={dialog?.kind === "delete" ? dialogFailure : undefined}
        />
        <LiveMessage
          role="status"
          message={dialog?.kind === "delete" ? promptProgress : undefined}
        />
      </ConfirmDialog>
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  action: { flexBasis: 120, flexGrow: 1 },
});
