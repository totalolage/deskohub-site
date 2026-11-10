import {
  accountPhoneRegion,
  type CustomerProfile,
} from "@deskohub/workspace-customer-api";
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import {
  useIsFocused,
  useNavigation,
  usePreventRemove,
  useRoute,
} from "expo-router";
import { useEffect, useRef, useState } from "react";
import type { TextInputInstance } from "react-native";
import { useSettledResultReset } from "../../customer-api/settled-result-reset";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import type {
  BillingChoice,
  CompletionTextField,
  ProfileDraft,
  ProfileTextField,
} from "./profile-draft";
import type { ProfileFieldRefs } from "./profile-fields";
import {
  currentDraft,
  type EditedProfile,
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
export function useProfileForm(account: {
  readonly profile: CustomerProfile;
  /** The account's saved language, whose phone region the Workspace reads. */
  readonly locale: string | null;
}) {
  const edited: EditedProfile = {
    profile: account.profile,
    phoneRegion: accountPhoneRegion(account.locale),
  };
  const [edits, setEdits] = useAtom(profileEditsAtom);
  const result = useAtomValue(saveProfileAtom);
  const save = useAtomSet(saveProfileAtom);
  const state = profileSubmitState(result);
  const draft = currentDraft(edits, edited);
  useSettledResultReset(saveProfileAtom);
  const change = (change: Partial<ProfileDraft>) => {
    setEdits(editedDraft(edits, edited, change));
    // The last save's message and field problems no longer describe it.
    if (!result.waiting) save(Atom.Reset);
  };
  return {
    draft,
    state,
    unsaved: hasUnsavedChanges(edits, edited),
    setField: (field: ProfileTextField, value: string) =>
      change({ [field]: value }),
    setBillingKind: (billingKind: BillingChoice) => change({ billingKind }),
    discard: () => setEdits(Option.none()),
    save: () => save({ draft, phoneRegion: edited.phoneRegion }),
  };
}

/**
 * Focuses the first invalid field after each refused submit, when this
 * screen is the one showing and the field is on it. Otherwise the form
 * points at the screen that has it.
 */
export function useFocusFirstInvalid<F extends CompletionTextField>(
  state: ProfileSubmitState,
  fields: ReadonlyArray<F>
) {
  const inputs: ProfileFieldRefs = useRef(
    new Map<CompletionTextField, TextInputInstance | null>()
  );
  const focused = useIsFocused();
  const refusal = state._tag === "Invalid" ? state : undefined;
  const first = Option.getOrUndefined(
    Option.flatMap(
      Option.fromNullishOr(refusal),
      ({ invalid }) => invalid.first
    )
  );
  const shown = first !== undefined && fields.includes(first as F);
  // Each refusal is a new attempt, even when it names the same field again.
  const attempt = refusal?.attempt;
  useEffect(() => {
    if (focused && shown && first !== undefined && attempt !== undefined)
      inputs.current.get(first)?.focus();
  }, [focused, shown, first, attempt]);
  return { inputs, invalidElsewhere: first !== undefined && !shown };
}

/** The field problems of the last submit, if it was refused as invalid. */
export const invalidOf = (state: ProfileSubmitState) =>
  state._tag === "Invalid" ? state.invalid : undefined;

/** A screen in a navigator's stack, as the guard reads it. */
interface StackRoute {
  readonly key: string;
  readonly name: string;
}

/**
 * Whether removing the screen `key` goes back to a screen in `sharedWith`,
 * which edits the same draft: the edits stay, and that screen guards them in
 * turn. An action that also removes the screen below asks there.
 */
export const returnsToSharedDraft = ({
  routes,
  key,
  sharedWith,
}: {
  readonly routes: ReadonlyArray<StackRoute>;
  readonly key: string;
  readonly sharedWith: ReadonlyArray<string>;
}) => {
  const below = routes[routes.findIndex((route) => route.key === key) - 1];
  return below !== undefined && sharedWith.includes(below.name);
};

/**
 * Holds a navigation away from unsaved changes until the customer decides:
 * keep editing cancels it, discard drops the edits and then completes it.
 */
export function useUnsavedChangesGuard({
  unsaved,
  onDiscard,
  sharedWith,
}: {
  readonly unsaved: boolean;
  readonly onDiscard: () => void;
  readonly sharedWith: ReadonlyArray<string>;
}) {
  const [leave, setLeave] = useState<(() => void) | undefined>(undefined);
  const navigation = useNavigation();
  const route = useRoute();
  usePreventRemove(
    unsaved &&
      !returnsToSharedDraft({
        routes: navigation.getState()?.routes ?? [],
        key: route.key,
        sharedWith,
      }),
    ({ repeat }) => setLeave(() => repeat)
  );
  // The navigation completes once the discarded edits are gone.
  useEffect(() => {
    if (!unsaved && leave !== undefined) {
      setLeave(undefined);
      leave();
    }
  }, [unsaved, leave]);
  return {
    asking: unsaved && leave !== undefined,
    keepEditing: () => setLeave(undefined),
    discard: onDiscard,
  };
}

/** Asks before leaving with unsaved changes (`useUnsavedChangesGuard`). */
export function UnsavedChangesGuard({
  unsaved,
  onDiscard,
  sharedWith = [],
  locale,
}: {
  readonly unsaved: boolean;
  readonly onDiscard: () => void;
  readonly sharedWith?: ReadonlyArray<string>;
  readonly locale: AppLocale;
}) {
  const guard = useUnsavedChangesGuard({ unsaved, onDiscard, sharedWith });
  return (
    <ConfirmDialog
      visible={guard.asking}
      title={m.profile_unsaved_title({}, { locale })}
      body={m.profile_unsaved_body({}, { locale })}
      confirmLabel={m.profile_unsaved_discard({}, { locale })}
      cancelLabel={m.profile_unsaved_keep({}, { locale })}
      destructive
      onConfirm={guard.discard}
      onCancel={guard.keepEditing}
    />
  );
}
