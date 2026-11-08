import type { CustomerProfile } from "@deskohub/workspace-customer-api";
import {
  RegistryContext,
  useAtom,
  useAtomSet,
  useAtomValue,
} from "@effect/atom-react";
import { Match, Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { usePreventRemove } from "expo-router";
import { useContext, useEffect, useRef, useState } from "react";
import type { TextInputInstance } from "react-native";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { Button, LiveMessage } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import type {
  BillingChoice,
  CompletionTextField,
  ProfileDraft,
  ProfileTextField,
} from "./profile-draft";
import type { ProfileFieldRefs } from "./profile-fields";
import {
  currentDraft,
  editedDraft,
  hasUnsavedChanges,
  type ProfileSubmitState,
  profileEditsAtom,
  profileSubmitState,
  saveProfileAtom,
} from "./profile-save";

/**
 * The shared profile draft for the Profile and Billing screens of a linked
 * account: its current values, whether it has unsaved changes, and its save.
 */
export function useProfileForm(profile: CustomerProfile) {
  const [edits, setEdits] = useAtom(profileEditsAtom);
  const result = useAtomValue(saveProfileAtom);
  const save = useAtomSet(saveProfileAtom);
  const state = profileSubmitState(result);
  const draft = currentDraft(edits, profile);
  useSettledResultReset(saveProfileAtom);
  const change = (change: Partial<ProfileDraft>) => {
    setEdits(editedDraft(edits, profile, change));
    // The last save's message and field problems no longer describe it.
    if (!result.waiting) save(Atom.Reset);
  };
  return {
    draft,
    state,
    unsaved: hasUnsavedChanges(edits, profile),
    setField: (field: ProfileTextField, value: string) =>
      change({ [field]: value }),
    setBillingKind: (billingKind: BillingChoice) => change({ billingKind }),
    discard: () => setEdits(Option.none()),
    save: () => save(draft),
  };
}

/**
 * Forgets a settled save or completion when the screen goes, so the next
 * visit starts without the last message. One still running keeps going: the
 * server may apply it, and its account read must still happen.
 */
export function useSettledResultReset(
  atom: Atom.Writable<{ readonly waiting: boolean }, typeof Atom.Reset>
) {
  const registry = useContext(RegistryContext);
  useEffect(
    () => () => {
      if (!registry.get(atom).waiting) registry.set(atom, Atom.Reset);
    },
    [registry, atom]
  );
}

/** The first invalid field to focus after a submit, if this form shows it. */
export function useFocusFirstInvalid<F extends CompletionTextField>(
  state: ProfileSubmitState,
  fields: ReadonlyArray<F>
) {
  const inputs: ProfileFieldRefs = useRef(
    new Map<CompletionTextField, TextInputInstance | null>()
  );
  const first =
    state._tag === "Invalid"
      ? Option.getOrUndefined(state.invalid.first)
      : undefined;
  const shown = first !== undefined && fields.includes(first as F);
  useEffect(() => {
    if (shown && first !== undefined) inputs.current.get(first)?.focus();
  }, [shown, first]);
  return { inputs, invalidElsewhere: first !== undefined && !shown };
}

/** The field problems of the last submit, if it was refused as invalid. */
export const invalidOf = (state: ProfileSubmitState) =>
  state._tag === "Invalid" ? state.invalid : undefined;

/**
 * Asks before leaving with unsaved changes; discarding drops the edits and
 * then completes the navigation the customer started.
 */
export function UnsavedChangesGuard({
  unsaved,
  onDiscard,
  locale,
}: {
  readonly unsaved: boolean;
  readonly onDiscard: () => void;
  readonly locale: AppLocale;
}) {
  const [leave, setLeave] = useState<(() => void) | undefined>(undefined);
  usePreventRemove(unsaved, ({ repeat }) => setLeave(() => repeat));
  useEffect(() => {
    if (!unsaved && leave !== undefined) {
      setLeave(undefined);
      leave();
    }
  }, [unsaved, leave]);
  return (
    <ConfirmDialog
      visible={unsaved && leave !== undefined}
      title={m.profile_unsaved_title({}, { locale })}
      body={m.profile_unsaved_body({}, { locale })}
      confirmLabel={m.profile_unsaved_discard({}, { locale })}
      cancelLabel={m.profile_unsaved_keep({}, { locale })}
      destructive
      onConfirm={onDiscard}
      onCancel={() => setLeave(undefined)}
    />
  );
}

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
