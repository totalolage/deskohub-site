import type { CustomerProfile } from "@deskohub/workspace-customer-api";
import {
  RegistryContext,
  useAtom,
  useAtomSet,
  useAtomValue,
} from "@effect/atom-react";
import { Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import {
  useIsFocused,
  useNavigation,
  usePreventRemove,
  useRoute,
} from "expo-router";
import { useContext, useEffect, useRef, useState } from "react";
import type { TextInputInstance } from "react-native";
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

/**
 * Asks before leaving with unsaved changes; discarding drops the edits and
 * then completes the navigation the customer started. Going back to another
 * screen in `sharedWith`, which edits the same draft, keeps the edits: that
 * screen guards them in turn.
 */
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
  const [leave, setLeave] = useState<(() => void) | undefined>(undefined);
  const navigation = useNavigation();
  const route = useRoute();
  const routes = navigation.getState()?.routes ?? [];
  const below = routes[routes.findIndex(({ key }) => key === route.key) - 1];
  const returnsToSharedDraft =
    below !== undefined && sharedWith.includes(below.name);
  // An action that also removes the screen below asks there.
  usePreventRemove(unsaved && !returnsToSharedDraft, ({ repeat }) =>
    setLeave(() => repeat)
  );
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
