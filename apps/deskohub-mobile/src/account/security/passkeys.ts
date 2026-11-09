import type { AccountPasskey } from "@deskohub/workspace-customer-api";
import { type DateTime, Effect, Exit, Match, Option, Predicate } from "effect";
import type { AsyncResult, Atom } from "effect/unstable/reactivity";
import { isReauthenticationRequired } from "../../auth/auth-session-state";
import {
  CustomerApi,
  CustomerAuthApi,
} from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import {
  customerRead,
  customerWrite,
  refreshAfterWrite,
} from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  type CustomerViewError,
  viewErrorOf,
} from "../../customer-api/customer-view-error";
import { parseInstant } from "../../i18n/date-time-format";

/** The longest passkey name the site accepts, after trimming. */
export const passkeyNameMaximumLength = 64;

/**
 * The account's passkeys (GET /account/passkeys). Not an account read, so it
 * spends no read budget. Fails with `CustomerFeatureUnavailable` while the
 * release withholds passkeys.
 */
export const passkeysAtom = customerDataRuntime.atom(
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.account.listPasskeys()
  ).pipe(customerRead({ accountRead: false }))
);

/**
 * Whether the release offers passkeys. A `FeatureUnavailable` answer, even
 * after an earlier list, hides the passkey part of the screen.
 */
export const passkeysReleased = <A, E extends CustomerRequestFailure>(
  result: AsyncResult.AsyncResult<A, E>
): boolean =>
  result._tag !== "Failure" ||
  !Match.value(viewErrorOf(result.cause)).pipe(
    Match.tag("FeatureUnavailable", ({ feature }) => feature === "passkeys"),
    Match.orElse(() => false)
  );

/** What a passkey row shows. */
export interface PasskeyRow {
  readonly id: string;
  /** The passkey's name, or the default name for an unnamed one. */
  readonly name: string;
  /** The provider, only when it says something the name doesn't. */
  readonly provider: string | undefined;
  /** None when the server's date can't be read. */
  readonly createdAt: Option.Option<DateTime.Utc>;
}

/** A passkey as its row shows it; unnamed passkeys get `defaultName`. */
export const passkeyRow = (
  passkey: AccountPasskey,
  defaultName: string
): PasskeyRow => {
  const name = Option.fromNullishOr(passkey.name).pipe(
    Option.filter((candidate) => candidate.trim() !== ""),
    Option.getOrElse(() => defaultName)
  );
  return {
    id: passkey.id,
    name,
    provider: passkey.provider === name ? undefined : passkey.provider,
    createdAt: parseInstant(passkey.createdAt),
  };
};

/** How a rename draft compares with the passkey's shown name. */
export type PasskeyNameCheck =
  | { readonly _tag: "Valid"; readonly name: string }
  /** The shown name again: close without a request. */
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Required" }
  | { readonly _tag: "TooLong" };

/** Checks a rename draft: trimmed, not empty, at most 64 characters. */
export const checkPasskeyName = ({
  draft,
  shownName,
}: {
  readonly draft: string;
  readonly shownName: string;
}): PasskeyNameCheck => {
  const name = draft.trim();
  if (name === "") return { _tag: "Required" };
  if (name.length > passkeyNameMaximumLength) return { _tag: "TooLong" };
  if (name === shownName) return { _tag: "Unchanged" };
  return { _tag: "Valid", name };
};

/** How a passkey rename or deletion ended, as the screen shows it. */
export type PasskeyWriteOutcome =
  | "succeeded"
  /** The session is too old: confirm it's you, then try again. */
  | "reauthentication-required"
  /** The passkey was already removed; the list was refreshed. */
  | "gone"
  /** It may have been applied; the list was refreshed. */
  | "unconfirmed"
  | "failed";

const writeFailure = (error: CustomerViewError): PasskeyWriteOutcome =>
  Match.value(error).pipe(
    Match.tag("AuthRejected", (rejection) =>
      Match.value(rejection).pipe(
        Match.when(
          isReauthenticationRequired,
          () => "reauthentication-required" as const
        ),
        Match.when({ reason: "not-found" }, () => "gone" as const),
        Match.orElse(() => "failed" as const)
      )
    ),
    Match.tag("Unconfirmed", () => "unconfirmed" as const),
    Match.orElse(() => "failed" as const)
  );

/** The outcome of a rename or deletion run through its atom. */
export const passkeyWriteOutcome = <A, E extends CustomerRequestFailure>(
  exit: Exit.Exit<A, E>
): PasskeyWriteOutcome =>
  Exit.match(exit, {
    onSuccess: () => "succeeded",
    onFailure: (cause) => writeFailure(viewErrorOf(cause)),
  });

const isGone = (error: unknown) =>
  Predicate.isTagged(error, "CustomerAuthRejected") &&
  Predicate.hasProperty(error, "reason") &&
  error.reason === "not-found";

// A passkey Better Auth no longer knows is gone from the list too.
const refreshWhenGone =
  (get: Atom.FnContext) =>
  <A, E, R>(write: Effect.Effect<A, E, R>) =>
    Effect.tapError(write, (error) =>
      Effect.sync(() => get.refresh(passkeysAtom)).pipe(
        Effect.when(Effect.succeed(isGone(error)))
      )
    );

// Better Auth 1.7.2 doesn't ask for a fresh session to rename or delete a
// passkey; `SESSION_NOT_FRESH` is still mapped to reauthentication in case a
// later release does.

/** Renames a passkey (Better Auth), then refreshes the list. */
export const renamePasskeyAtom = customerDataRuntime.fn(
  (rename: { readonly id: string; readonly name: string }, get) =>
    Effect.flatMap(Effect.service(CustomerAuthApi), (auth) =>
      auth.auth.updatePasskey({ payload: rename })
    ).pipe(
      customerWrite,
      refreshAfterWrite(get, [passkeysAtom]),
      refreshWhenGone(get)
    )
);

/** Deletes a passkey (Better Auth), then refreshes the list. */
export const deletePasskeyAtom = customerDataRuntime.fn((id: string, get) =>
  Effect.flatMap(Effect.service(CustomerAuthApi), (auth) =>
    auth.auth.deletePasskey({ payload: { id } })
  ).pipe(
    customerWrite,
    refreshAfterWrite(get, [passkeysAtom]),
    refreshWhenGone(get)
  )
);
