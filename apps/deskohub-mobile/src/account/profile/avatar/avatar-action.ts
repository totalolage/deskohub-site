import type {
  CustomerAvatarRejected,
  CustomerAvatarRejectionReason,
} from "@deskohub/workspace-customer-api";
import { Cause, Data, Effect, Match, Option, Predicate, Stream } from "effect";
import { AsyncResult, type Atom } from "effect/unstable/reactivity";
import { CustomerApi } from "../../../customer-api/customer-api.service";
import {
  accountAtom,
  customerDataRuntime,
} from "../../../customer-api/customer-data-runtime";
import {
  customerWrite,
  refreshAfterWrite,
} from "../../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "../../../customer-api/customer-view-error";
import {
  type DeviceCapabilityFailed,
  ImageLibrary,
} from "../../../customer-api/device-capabilities";
import {
  type AvatarFile,
  type AvatarFileUnreadable,
  acceptAvatarFile,
} from "./avatar-file";
import { avatarFormData } from "./avatar-form-data";

export type AvatarAction = "change" | "remove";

/** How far an avatar action got; each run starts with its first step. */
export type AvatarStep =
  | "picking"
  | "uploading"
  | "removing"
  | "cancelled"
  | "updated"
  | "removed";

/**
 * Every failure an avatar action can end in. A stream run ending before its
 * first step (never here) would be a `NoSuchElementError`.
 */
export type AvatarActionFailure =
  | Cause.NoSuchElementError
  | CustomerRequestFailure
  | CustomerAvatarRejected
  | AvatarFileUnreadable
  | DeviceCapabilityFailed;

// The account no longer has a usable profile: read it again, so the screen
// follows its new state.
const refreshWhenLinkRequired =
  (get: Atom.FnContext) =>
  <A, E, R>(write: Effect.Effect<A, E, R>) =>
    Effect.tapError(write, (error) =>
      Effect.sync(() => get.refresh(accountAtom)).pipe(
        Effect.when(
          Effect.succeed(
            Predicate.isTagged(error, "CustomerAccountLinkRequired")
          )
        )
      )
    );

// One customer API write that changes the account's avatar.
const writeAvatar = <A, E, R>({
  get,
  write,
}: {
  readonly get: Atom.FnContext;
  readonly write: Effect.Effect<A, E, R>;
}) =>
  write.pipe(
    customerWrite,
    refreshAfterWrite(get, [accountAtom]),
    refreshWhenLinkRequired(get)
  );

// The image the customer picked, checked against the upload contract; none
// when they cancelled.
const pickedAvatarFile = Effect.flatMap(
  Effect.service(ImageLibrary),
  (library) => library.pickImage
).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeedNone,
      onSome: (picked) => Effect.asSome(acceptAvatarFile(picked)),
    })
  )
);

const uploadAvatar = ({
  file,
  get,
}: {
  readonly file: AvatarFile;
  readonly get: Atom.FnContext;
}) =>
  Effect.flatMap(avatarFormData(file), (payload) =>
    writeAvatar({
      get,
      write: Effect.flatMap(Effect.service(CustomerApi), (api) =>
        api.account.uploadAvatar({ payload })
      ),
    })
  );

const changeAvatar = (get: Atom.FnContext) =>
  Stream.concat(
    Stream.succeed<AvatarStep>("picking"),
    Stream.unwrap(
      Effect.map(
        pickedAvatarFile,
        Option.match({
          onNone: () => Stream.succeed<AvatarStep>("cancelled"),
          onSome: (file) =>
            Stream.concat(
              Stream.succeed<AvatarStep>("uploading"),
              Stream.fromEffect(
                uploadAvatar({ file, get }).pipe(
                  Effect.as<AvatarStep>("updated")
                )
              )
            ),
        })
      )
    )
  );

const removeAvatar = (get: Atom.FnContext) =>
  Stream.concat(
    Stream.succeed<AvatarStep>("removing"),
    Stream.fromEffect(
      writeAvatar({
        get,
        write: Effect.flatMap(Effect.service(CustomerApi), (api) =>
          api.account.removeAvatar()
        ),
      }).pipe(Effect.as<AvatarStep>("removed"))
    )
  );

/**
 * Changes (pick, check, PUT /account/avatar) or removes (DELETE) the avatar.
 * Both refresh the account once the server may hold a new avatar.
 */
export const avatarActionAtom = customerDataRuntime.fn(
  (action: AvatarAction, get) =>
    ({ change: changeAvatar, remove: removeAvatar })[action](get)
);

/** What the avatar section shows for its latest action. */
export type AvatarFeedback = Data.TaggedEnum<{
  Idle: Record<never, never>;
  /** The picker is open: controls wait, nothing to announce. */
  Picking: Record<never, never>;
  Uploading: Record<never, never>;
  Removing: Record<never, never>;
  Updated: Record<never, never>;
  Removed: Record<never, never>;
  /** The app or the Workspace refused the file. */
  Rejected: { readonly reason: CustomerAvatarRejectionReason };
  FileUnreadable: Record<never, never>;
  PickerFailed: Record<never, never>;
  /** The release withholds avatars: the section hides. */
  Withheld: Record<never, never>;
  Failed: { readonly error: CustomerViewError };
}>;

export const AvatarFeedback = Data.taggedEnum<AvatarFeedback>();

const busyFeedback: Partial<Record<AvatarStep, AvatarFeedback>> = {
  uploading: AvatarFeedback.Uploading(),
  removing: AvatarFeedback.Removing(),
};

const stepFeedback = (step: AvatarStep): AvatarFeedback =>
  Match.value(step).pipe(
    Match.when("updated", () => AvatarFeedback.Updated()),
    Match.when("removed", () => AvatarFeedback.Removed()),
    Match.when("uploading", () => AvatarFeedback.Uploading()),
    Match.when("removing", () => AvatarFeedback.Removing()),
    Match.when("picking", () => AvatarFeedback.Picking()),
    Match.when("cancelled", () => AvatarFeedback.Idle()),
    Match.exhaustive
  );

const fromViewError = (error: CustomerViewError): AvatarFeedback =>
  Match.value(error).pipe(
    Match.tag("AvatarRejected", ({ reason }) =>
      AvatarFeedback.Rejected({ reason })
    ),
    Match.tag("FeatureUnavailable", () => AvatarFeedback.Withheld()),
    Match.orElse((error) => AvatarFeedback.Failed({ error }))
  );

const failureFeedback = (error: AvatarActionFailure): AvatarFeedback =>
  Match.value(error).pipe(
    Match.tag("DeviceCapabilityFailed", () => AvatarFeedback.PickerFailed()),
    Match.tag("AvatarFileUnreadable", () => AvatarFeedback.FileUnreadable()),
    Match.tag("NoSuchElementError", () =>
      AvatarFeedback.Failed({ error: CustomerViewError.Unexpected() })
    ),
    Match.orElse((failure) => fromViewError(toCustomerViewError(failure)))
  );

/**
 * The feedback for the action's result. While a run is under way before its
 * first step, the customer is picking.
 */
export const avatarFeedback = (
  result: AsyncResult.AsyncResult<AvatarStep, AvatarActionFailure>
): AvatarFeedback =>
  result.waiting
    ? Option.getOrElse(
        Option.flatMap(AsyncResult.value(result), (step) =>
          Option.fromNullishOr(busyFeedback[step])
        ),
        () => AvatarFeedback.Picking()
      )
    : AsyncResult.match(result, {
        onInitial: () => AvatarFeedback.Idle(),
        onSuccess: ({ value }) => stepFeedback(value),
        onFailure: ({ cause }) =>
          Option.match(Cause.findErrorOption(cause), {
            onNone: () =>
              AvatarFeedback.Failed({ error: CustomerViewError.Unexpected() }),
            onSome: failureFeedback,
          }),
      });

/** Whether an action is under way, so the controls wait. */
export const isAvatarBusy = (feedback: AvatarFeedback) =>
  AvatarFeedback.$is("Picking")(feedback) ||
  AvatarFeedback.$is("Uploading")(feedback) ||
  AvatarFeedback.$is("Removing")(feedback);
