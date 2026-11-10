import type {
  CustomerAccountState,
  CustomerProfile,
  ProfileCompletionReferralOutcome,
} from "@deskohub/workspace-customer-api";
import { Cause, Data, Effect, Match, Option, Predicate } from "effect";
import { type AsyncResult, Atom } from "effect/unstable/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import {
  accountAtom,
  customerDataRuntime,
} from "../../customer-api/customer-data-runtime";
import {
  customerWrite,
  refreshAfterWrite,
} from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import {
  type CompletionDraft,
  type CompletionTextField,
  completionDraftOf,
  type ProfileDraft,
  type ProfileDraftInvalid,
  type ProfileTextField,
  profileDraftOf,
  sameDraft,
  validateCompletionDraft,
  validateProfileDraft,
} from "./profile-draft";

/** The draft can't be saved: nothing was sent. */
export class ProfileDraftRejected<
  F extends CompletionTextField,
> extends Data.TaggedError("ProfileDraftRejected")<{
  readonly invalid: ProfileDraftInvalid<F>;
}> {}

/** Completion refused the referral code; nothing was created. */
export class ReferralCodeUnavailable extends Data.TaggedError(
  "ReferralCodeUnavailable"
) {}

/**
 * What the customer changed and hasn't saved: none while the form shows the
 * saved profile. The Profile and Billing screens edit this one draft, so a
 * save from either sends both screens' fields. Kept per account registry.
 */
export const profileEditsAtom = Atom.make(Option.none<ProfileDraft>()).pipe(
  Atom.keepAlive
);

/**
 * The saved profile a form edits, and the region its phone is read in: the
 * phone region of the account's saved language (`accountPhoneRegion`).
 */
export interface EditedProfile {
  readonly profile: CustomerProfile;
  readonly phoneRegion: string;
}

/** The draft a form shows: the customer's edits, else the saved profile. */
export const currentDraft = (
  edits: Option.Option<ProfileDraft>,
  { profile, phoneRegion }: EditedProfile
): ProfileDraft =>
  Option.getOrElse(edits, () => profileDraftOf(profile, phoneRegion));

/** Whether leaving now would lose changes. */
export const hasUnsavedChanges = (
  edits: Option.Option<ProfileDraft>,
  { profile, phoneRegion }: EditedProfile
) =>
  Option.exists(
    edits,
    (draft) =>
      !sameDraft(draft, profileDraftOf(profile, phoneRegion), phoneRegion)
  );

/** The draft after a change to some of its fields. */
export const editedDraft = (
  edits: Option.Option<ProfileDraft>,
  edited: EditedProfile,
  change: Partial<ProfileDraft>
): Option.Option<ProfileDraft> =>
  Option.some({ ...currentDraft(edits, edited), ...change });

// The account as read again after a write; a failed read leaves `None`.
const rereadAccount = (get: Atom.FnContext) =>
  get.result(accountAtom, { suspendOnWaiting: true }).pipe(Effect.option);

const isLinkRequired = (error: unknown) =>
  Predicate.isTagged(error, "CustomerAccountLinkRequired");

// The account no longer has a usable profile: read it again so the screen
// gates on what it is now.
const refreshAccountWhenLinkRequired =
  (get: Atom.FnContext) =>
  <A, E, R>(write: Effect.Effect<A, E, R>) =>
    Effect.tapError(write, (error) =>
      Effect.sync(() => get.refresh(accountAtom)).pipe(
        Effect.when(Effect.succeed(isLinkRequired(error)))
      )
    );

// Once the account read again shows the saved state, the form shows what the
// server stored (it may have normalized a value), so the edits go. They stay
// when that read fails, or (for a completion) still shows no profile, so
// nothing typed is lost. An unconfirmed save keeps them too: they stop
// counting as unsaved once the account read again holds the same values.
const clearEditsOnceShown = <D>({
  get,
  edits,
  shown,
}: {
  readonly get: Atom.FnContext;
  readonly edits: Atom.Writable<Option.Option<D>>;
  readonly shown: (account: CustomerAccountState) => boolean;
}) =>
  rereadAccount(get).pipe(
    Effect.tap((account) =>
      Effect.sync(() => get.set(edits, Option.none())).pipe(
        Effect.when(Effect.succeed(Option.exists(account, shown)))
      )
    ),
    Effect.asVoid
  );

// An unconfirmed write keeps its failure until the account read again shows
// what the server holds.
const waitForReread =
  (get: Atom.FnContext) =>
  <A, E, R>(write: Effect.Effect<A, E, R>) =>
    Effect.tapError(write, (error) =>
      rereadAccount(get).pipe(
        Effect.when(
          Effect.succeed(Predicate.isTagged(error, "CustomerWriteUnconfirmed"))
        )
      )
    );

/** What a save submits: the draft and the region its phone is read in. */
export interface ProfileSave {
  readonly draft: ProfileDraft;
  readonly phoneRegion: string;
}

/**
 * Saves the complete profile (PUT /account/profile) from a draft. Invalid
 * drafts fail with the fields to fix before anything is sent; the account is
 * read again after the save (or an unconfirmed one) and when it turns out to
 * need linking.
 */
export const saveProfileAtom = customerDataRuntime
  .fn(({ draft, phoneRegion }: ProfileSave, get) =>
    Effect.fromResult(validateProfileDraft(draft, phoneRegion)).pipe(
      Effect.mapError(
        (invalid) => new ProfileDraftRejected<ProfileTextField>({ invalid })
      ),
      Effect.flatMap((payload) =>
        Effect.flatMap(Effect.service(CustomerApi), (api) =>
          api.account.updateProfile({ payload })
        ).pipe(
          customerWrite,
          refreshAfterWrite(get, [accountAtom]),
          refreshAccountWhenLinkRequired(get),
          waitForReread(get)
        )
      ),
      Effect.tap(() =>
        clearEditsOnceShown({ get, edits: profileEditsAtom, shown: () => true })
      ),
      // A save has no referral outcome, unlike a completion.
      Effect.as(Option.none<ProfileCompletionReferralOutcome>())
    )
  )
  .pipe(Atom.keepAlive);

/** The completion form's own draft; the account has no profile yet. */
export const completionEditsAtom = Atom.make(
  Option.none<CompletionDraft>()
).pipe(Atom.keepAlive);

/**
 * What a completion submits: the draft, the code it was prefilled with, and
 * the region its phone is read in.
 */
export interface ProfileCompletion {
  readonly draft: CompletionDraft;
  readonly invitationCode: string | undefined;
  readonly phoneRegion: string;
}

/**
 * Creates the customer profile (POST /account/profile) and reads the account
 * again so the gates move to the linked account. Succeeds with the referral
 * code's outcome when one was submitted.
 */
export const completeProfileAtom = customerDataRuntime
  .fn(({ draft, invitationCode, phoneRegion }: ProfileCompletion, get) =>
    Effect.fromResult(
      validateCompletionDraft(draft, invitationCode, phoneRegion)
    ).pipe(
      Effect.mapError(
        (invalid) => new ProfileDraftRejected<CompletionTextField>({ invalid })
      ),
      Effect.flatMap((payload) =>
        Effect.flatMap(Effect.service(CustomerApi), (api) =>
          api.account.completeProfile({ headers: {}, payload })
        ).pipe(
          customerWrite,
          refreshAccountWhenLinkRequired(get),
          Effect.flatMap((answer) =>
            Match.value(answer).pipe(
              Match.discriminatorsExhaustive("status")({
                completed: ({ referral }) =>
                  Effect.succeed(Option.fromNullishOr(referral)),
                "referral-code-unavailable": () =>
                  Effect.fail(new ReferralCodeUnavailable()),
              })
            )
          ),
          refreshAfterWrite(get, [accountAtom]),
          waitForReread(get)
        )
      ),
      Effect.tap(() =>
        clearEditsOnceShown({
          get,
          edits: completionEditsAtom,
          shown: (account) => account.kind === "linked",
        })
      )
    )
  )
  .pipe(Atom.keepAlive);

/** The completion draft a form shows: edits, else the invitation prefill. */
export const currentCompletionDraft = (
  edits: Option.Option<CompletionDraft>,
  invitationCode: string | undefined
) => Option.getOrElse(edits, () => completionDraftOf(invitationCode));

/** The invitation code a completion-required account came with. */
export const invitationCodeOf = (account: CustomerAccountState) =>
  account.kind === "completion-required" ? account.referralCode : undefined;

/** What a profile form shows about its last save or completion. */
export type ProfileSubmitState = Data.TaggedEnum<{
  Idle: Record<never, never>;
  Submitting: Record<never, never>;
  Done: {
    readonly referral: Option.Option<ProfileCompletionReferralOutcome>;
  };
  /**
   * Fields to fix; nothing was sent or created. `attempt` tells refusals
   * apart, so a form can focus again after the same refusal.
   */
  Invalid: {
    readonly invalid: ProfileDraftInvalid<CompletionTextField>;
    readonly attempt: object;
  };
  /**
   * The request failed. `LinkRequired` means the account was read again and
   * gates anew; `Unconfirmed` that the form shows the account read again.
   */
  Failed: { readonly error: CustomerViewError };
}>;

export const ProfileSubmitState = Data.taggedEnum<ProfileSubmitState>();

const referralFieldInvalid: ProfileDraftInvalid<CompletionTextField> = {
  fields: { referralCode: "invalid" },
  first: Option.some("referralCode"),
};

type SubmitFailure =
  | ProfileDraftRejected<CompletionTextField>
  | ReferralCodeUnavailable
  | CustomerRequestFailure;

const isDraftRefusal = (
  error: SubmitFailure
): error is
  | ProfileDraftRejected<CompletionTextField>
  | ReferralCodeUnavailable =>
  Predicate.isTagged(error, "ProfileDraftRejected") ||
  Predicate.isTagged(error, "ReferralCodeUnavailable");

const invalidOf = (
  refusal: ProfileDraftRejected<CompletionTextField> | ReferralCodeUnavailable
) =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      ProfileDraftRejected: ({ invalid }) => invalid,
      ReferralCodeUnavailable: () => referralFieldInvalid,
    })
  );

const failureState = (cause: Cause.Cause<SubmitFailure>) =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () =>
      ProfileSubmitState.Failed({ error: CustomerViewError.Unexpected() }),
    onSome: (error) =>
      isDraftRefusal(error)
        ? ProfileSubmitState.Invalid({
            invalid: invalidOf(error),
            attempt: error,
          })
        : ProfileSubmitState.Failed({ error: toCustomerViewError(error) }),
  });

/**
 * The state of a save or completion result. A refused referral code is an
 * invalid referral code field, so the form focuses it.
 */
export const profileSubmitState = (
  result: AsyncResult.AsyncResult<
    Option.Option<ProfileCompletionReferralOutcome>,
    SubmitFailure
  >
): ProfileSubmitState =>
  result.waiting
    ? ProfileSubmitState.Submitting()
    : Match.value(result).pipe(
        Match.tagsExhaustive({
          Initial: () => ProfileSubmitState.Idle(),
          Success: ({ value }) => ProfileSubmitState.Done({ referral: value }),
          Failure: ({ cause }) => failureState(cause),
        })
      );
