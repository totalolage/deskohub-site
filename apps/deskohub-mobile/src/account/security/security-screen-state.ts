import { Data, Match } from "effect";
import type { AuthUser } from "../../auth/auth-session-state";
import type { NativeSignInFailure } from "../../auth/native-sign-in-errors";
import type { ReauthenticationOutcome } from "../../auth/reauthentication";
import {
  type ReauthenticationNotice,
  reauthenticationNotice,
} from "../../auth/reauthentication-notice";
import type { AuthTaskState } from "../../auth/use-auth-task";
import {
  checkPasskeyName,
  type PasskeyNameCheck,
  type PasskeyRow,
  type PasskeyWriteOutcome,
} from "./passkeys";

/** Why the last attempt in an open dialog didn't go through. */
export type PasskeyDialogFailure = Exclude<
  PasskeyWriteOutcome,
  "succeeded" | "gone"
>;

export type PasskeyDialog =
  | {
      readonly kind: "rename";
      readonly passkey: PasskeyRow;
      readonly draft: string;
      /** Validation shows once the customer tried to save. */
      readonly submitted: boolean;
      readonly failure: PasskeyDialogFailure | undefined;
    }
  | {
      readonly kind: "delete";
      readonly passkey: PasskeyRow;
      /** The account's only passkey: say email sign-in stays. */
      readonly last: boolean;
      readonly failure: PasskeyDialogFailure | undefined;
    };

/**
 * What the screen announces: a dialog's outcome after it closed, or that a
 * passkey is being added.
 */
export type SecurityAnnouncement = "renamed" | "deleted" | "gone" | "adding";

export interface SecurityScreenState {
  readonly dialog: PasskeyDialog | undefined;
  readonly announcement: SecurityAnnouncement | undefined;
  /** A passkey is being added: the other passkey controls wait. */
  readonly adding: boolean;
  /**
   * A change was refused because the sign-in is too old; `outcome` is the
   * latest `reauthenticate()`'s. Cleared once the customer repeats a change.
   */
  readonly reauthentication:
    | { readonly outcome: ReauthenticationOutcome | undefined }
    | undefined;
}

export const initialSecurityScreenState: SecurityScreenState = {
  dialog: undefined,
  announcement: undefined,
  adding: false,
  reauthentication: undefined,
};

export type SecurityScreenEvent = Data.TaggedEnum<{
  RenameOpened: { readonly passkey: PasskeyRow };
  DraftChanged: { readonly draft: string };
  /**
   * Save in the rename dialog; a valid new name also starts the write.
   * `shownName` is the passkey's name in the list now.
   */
  RenameSubmitted: { readonly shownName: string };
  DeleteOpened: {
    readonly passkey: PasskeyRow;
    readonly passkeyCount: number;
  };
  DialogCancelled: Record<never, never>;
  /** The customer repeats a change: the earlier reauthentication is spent. */
  WriteStarted: Record<never, never>;
  WriteEnded: { readonly outcome: PasskeyWriteOutcome };
  /**
   * The passkey prompt is about to open; like a repeated change, it spends
   * the earlier reauthentication.
   */
  PasskeyAddStarted: Record<never, never>;
  /** Adding a passkey needs a recent sign-in. */
  AddReauthenticationRequired: Record<never, never>;
  PasskeyAdded: Record<never, never>;
  /** The add ceremony ended, after its outcome. */
  PasskeyAddSettled: Record<never, never>;
  ReauthenticationEnded: { readonly outcome: ReauthenticationOutcome };
}>;

export const SecurityScreenEvent = Data.taggedEnum<SecurityScreenEvent>();

const reauthenticationRequested = { outcome: undefined } as const;

const writeEnded = (
  state: SecurityScreenState,
  outcome: PasskeyWriteOutcome
): SecurityScreenState => {
  const dialog = state.dialog;
  if (dialog === undefined) return state;
  return Match.value(outcome).pipe(
    Match.when("succeeded", () => ({
      ...state,
      dialog: undefined,
      announcement: ({ rename: "renamed", delete: "deleted" } as const)[
        dialog.kind
      ],
    })),
    Match.when("gone", () => ({
      ...state,
      dialog: undefined,
      announcement: "gone" as const,
    })),
    Match.when("reauthentication-required", (failure) => ({
      ...state,
      dialog: { ...dialog, failure },
      reauthentication: reauthenticationRequested,
    })),
    Match.orElse((failure) => ({ ...state, dialog: { ...dialog, failure } }))
  );
};

/** The screen's next state after `event`. */
export const securityScreenReducer = (
  state: SecurityScreenState,
  event: SecurityScreenEvent
): SecurityScreenState =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      RenameOpened: ({ passkey }) => ({
        ...state,
        announcement: undefined,
        dialog: {
          kind: "rename" as const,
          passkey,
          draft: passkey.name,
          submitted: false,
          failure: undefined,
        },
      }),
      DraftChanged: ({ draft }) =>
        state.dialog?.kind === "rename"
          ? { ...state, dialog: { ...state.dialog, draft } }
          : state,
      RenameSubmitted: ({ shownName }) => renameSubmitted(state, shownName),
      DeleteOpened: ({ passkey, passkeyCount }) => ({
        ...state,
        announcement: undefined,
        dialog: {
          kind: "delete" as const,
          passkey,
          last: passkeyCount === 1,
          failure: undefined,
        },
      }),
      DialogCancelled: () => ({ ...state, dialog: undefined }),
      WriteStarted: () => ({
        ...state,
        dialog:
          state.dialog === undefined
            ? undefined
            : { ...state.dialog, failure: undefined },
        reauthentication: undefined,
      }),
      WriteEnded: ({ outcome }) => writeEnded(state, outcome),
      PasskeyAddStarted: () => ({
        ...state,
        adding: true,
        announcement: "adding" as const,
        reauthentication: undefined,
      }),
      AddReauthenticationRequired: () => ({
        ...state,
        announcement: undefined,
        reauthentication: reauthenticationRequested,
      }),
      PasskeyAdded: () => ({ ...state, reauthentication: undefined }),
      PasskeyAddSettled: () => ({
        ...state,
        adding: false,
        announcement:
          state.announcement === "adding" ? undefined : state.announcement,
      }),
      ReauthenticationEnded: ({ outcome }) =>
        state.reauthentication === undefined
          ? state
          : { ...state, reauthentication: { outcome } },
    })
  );

/** What saving the rename dialog does. */
export type RenameSubmission =
  | { readonly _tag: "Save"; readonly id: string; readonly name: string }
  /** The unchanged name (or no rename dialog): close without a request. */
  | { readonly _tag: "Close" }
  /** The draft is invalid; the dialog shows why. */
  | { readonly _tag: "Invalid" };

/**
 * The name the list shows for the dialog's passkey now. A refresh after an
 * unconfirmed rename may already show the new name.
 */
export const shownPasskeyName = (
  dialog: PasskeyDialog,
  rows: ReadonlyArray<PasskeyRow> | undefined
): string =>
  rows?.find((row) => row.id === dialog.passkey.id)?.name ??
  dialog.passkey.name;

/**
 * Saving the rename dialog: a valid new name is saved, the name the list
 * shows closes without a request, an invalid one shows its validation.
 */
export const renameSubmission = (
  dialog: PasskeyDialog | undefined,
  shownName: string
): RenameSubmission => {
  if (dialog?.kind !== "rename") return { _tag: "Close" };
  return Match.value(checkPasskeyName({ draft: dialog.draft, shownName })).pipe(
    Match.tagsExhaustive({
      Valid: ({ name }) => ({
        _tag: "Save" as const,
        id: dialog.passkey.id,
        name,
      }),
      Unchanged: () => ({ _tag: "Close" as const }),
      Required: () => ({ _tag: "Invalid" as const }),
      TooLong: () => ({ _tag: "Invalid" as const }),
    })
  );
};

const renameSubmitted = (
  state: SecurityScreenState,
  shownName: string
): SecurityScreenState => {
  const dialog = state.dialog;
  if (dialog?.kind !== "rename") return state;
  return Match.value(renameSubmission(dialog, shownName)).pipe(
    Match.tagsExhaustive({
      Save: () => state,
      Close: () => ({ ...state, dialog: undefined }),
      Invalid: () => ({ ...state, dialog: { ...dialog, submitted: true } }),
    })
  );
};

/** The rename draft's validation, once the customer tried to save. */
export const renameValidation = (
  dialog: PasskeyDialog | undefined
): Extract<PasskeyNameCheck, { _tag: "Required" | "TooLong" }> | undefined => {
  if (dialog?.kind !== "rename" || !dialog.submitted) return undefined;
  const check = checkPasskeyName({
    draft: dialog.draft,
    shownName: dialog.passkey.name,
  });
  return check._tag === "Required" || check._tag === "TooLong"
    ? check
    : undefined;
};

/**
 * What the screen says about a reauthentication a change asked for: that the
 * customer must confirm it's them (until they did), and how the confirmation
 * itself is going.
 */
export const reauthenticationPrompt = (
  reauthentication: SecurityScreenState["reauthentication"],
  task: AuthTaskState<AuthUser, NativeSignInFailure>
): {
  readonly required: boolean;
  readonly notice: ReauthenticationNotice | undefined;
} => {
  if (reauthentication === undefined) {
    return { required: false, notice: undefined };
  }
  const notice = reauthenticationNotice(task, reauthentication.outcome);
  return { required: notice?.kind !== "confirmed", notice };
};
