import { Match } from "effect";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { Button, LiveMessage } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import type { ProfileSubmitState } from "./profile-save";

const statusMessage = (
  state: ProfileSubmitState,
  labels: { readonly submitting: string; readonly done: string }
): string | undefined =>
  Match.value(state).pipe(
    Match.tagsExhaustive({
      Idle: () => undefined,
      Submitting: () => labels.submitting,
      Done: () => labels.done,
      Invalid: () => undefined,
      Failed: () => undefined,
    })
  );

const failureMessage = (
  state: ProfileSubmitState,
  invalidMessage: string,
  locale: AppLocale
): string | undefined =>
  Match.value(state).pipe(
    Match.tagsExhaustive({
      Idle: () => undefined,
      Submitting: () => undefined,
      Done: () => undefined,
      Invalid: () => invalidMessage,
      Failed: ({ error }) =>
        error._tag === "LinkRequired"
          ? m.profile_link_required({}, { locale })
          : (sharedViewErrorMessage(error, locale) ??
            m.profile_save_failed({}, { locale })),
    })
  );

/**
 * The submit button with the submit's progress and outcome, announced in
 * live regions that stay mounted. `invalidMessage` says where the fields to
 * fix are.
 */
export function ProfileSubmitFooter({
  state,
  unsaved,
  onSubmit,
  submitLabel,
  submittingLabel,
  doneMessage,
  invalidMessage,
  locale,
}: {
  readonly state: ProfileSubmitState;
  readonly unsaved: boolean;
  readonly onSubmit: () => void;
  readonly submitLabel: string;
  readonly submittingLabel: string;
  readonly doneMessage: string;
  readonly invalidMessage: string;
  readonly locale: AppLocale;
}) {
  const submitting = state._tag === "Submitting";
  const unconfirmed =
    state._tag === "Failed" && state.error._tag === "Unconfirmed";
  return (
    <>
      <Button
        label={submitting ? submittingLabel : submitLabel}
        onPress={onSubmit}
        disabled={submitting || !unsaved}
      />
      <LiveMessage
        role="status"
        message={statusMessage(state, {
          submitting: submittingLabel,
          done: doneMessage,
        })}
      />
      <Notice
        tone={unconfirmed ? "warning" : "error"}
        message={failureMessage(state, invalidMessage, locale)}
      />
    </>
  );
}
