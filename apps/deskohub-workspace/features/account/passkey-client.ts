"use client";

import { Option, Schema } from "effect";
import { getSignInDestination } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { authClient } from "./auth.client";
import { forgetEmailSignInRequest } from "./email-sign-in-request";
import { rememberPasskeyOnThisBrowser } from "./passkey-prompt";
import { requestPasskeySignIn } from "./passkey-sign-in";
import type {
  AccountPasskey,
  PasskeyChangeResult,
  PasskeyConfirmationResult,
  PasskeyCreationResult,
  PasskeySignInResult,
} from "./passkeys";
import { recordSignInCompletion } from "./sign-in-analytics";

/*
 * Maps Better Auth passkey responses onto the screens' outcome unions. The
 * plugin client never throws for a ceremony: it resolves `{ data, error }`,
 * with the WebAuthn error code for a browser failure.
 */

const passkeyErrorSchema = Schema.Struct({
  code: Schema.optional(Schema.String),
});

/** A plugin response whose `data` this client reads with `dataSchema`. */
const passkeyResponseSchema = <Data extends Schema.Top>(dataSchema: Data) =>
  Schema.Struct({
    data: Schema.optional(Schema.NullOr(dataSchema)),
    error: Schema.NullOr(passkeyErrorSchema),
  });

type PasskeyResponse = {
  readonly error: typeof passkeyErrorSchema.Type | null;
};

const failedResponse: PasskeyResponse = { error: {} };

/** Settles a plugin call; a malformed response or a throw reads as failed. */
const settle = async <Response extends PasskeyResponse>(
  response: Promise<Option.Option<Response>>
): Promise<Response | PasskeyResponse> =>
  Option.getOrElse(
    await response.catch(() => Option.none<Response>()),
    () => failedResponse
  );

const decodeChangeResponse = Schema.decodeUnknownOption(
  passkeyResponseSchema(Schema.Unknown)
);
const decodeSignInResponse = Schema.decodeUnknownOption(
  passkeyResponseSchema(
    Schema.Struct({ user: Schema.Struct({ id: Schema.String }) })
  )
);
const decodeCreationResponse = Schema.decodeUnknownOption(
  passkeyResponseSchema(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optional(Schema.NullOr(Schema.String)),
      createdAt: Schema.Union([Schema.Date, Schema.String]),
    })
  )
);

/**
 * The customer closed the browser prompt, or a newer ceremony replaced it.
 * Browsers report a dismissed prompt as `NotAllowedError`, which the WebAuthn
 * library passes through.
 */
const cancelledCeremonyCodes = new Set([
  "ERROR_CEREMONY_ABORTED",
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
  "AUTH_CANCELLED",
]);

const isCancelled = (response: PasskeyResponse) =>
  cancelledCeremonyCodes.has(response.error?.code ?? "");

export const toPasskeySignInResult = (
  response: PasskeyResponse
): PasskeySignInResult => {
  if (response.error === null) return "signed-in";
  return isCancelled(response) ? "cancelled" : "failed";
};

export const toPasskeyConfirmationResult = (
  response: PasskeyResponse
): PasskeyConfirmationResult => {
  if (response.error === null) return "confirmed";
  if (response.error.code === "PASSKEY_ACCOUNT_MISMATCH") {
    return "wrong-account";
  }
  return isCancelled(response) ? "cancelled" : "failed";
};

export const toPasskeyCreationResult = (
  response: PasskeyResponse
): PasskeyCreationResult => {
  if (response.error === null) return "created";
  if (response.error.code === "SESSION_NOT_FRESH") {
    return "reauthentication-required";
  }
  return isCancelled(response) ? "cancelled" : "failed";
};

const toPasskeyChangeResult = (
  response: PasskeyResponse
): PasskeyChangeResult => (response.error === null ? "saved" : "failed");

/**
 * Signs in with a passkey, from the button or, with `autoFill`, from the
 * email field's autofill, and continues to the sign-in destination: a
 * same-origin `returnTo`, otherwise the account. Anything but a sign-in leaves
 * the page as it is. Aborting `signal` cancels the attempt, and a newer
 * attempt on the page cancels it too.
 *
 * Cancelling after the server accepted the passkey can't undo the sign-in:
 * the browser keeps the session and its bookkeeping, but the attempt resolves
 * as cancelled and doesn't navigate to its stale destination. The customer
 * stays, signed in, on the page that cancelled it.
 */
export const signInWithPasskey = async ({
  locale,
  returnTo,
  autoFill = false,
  signal,
}: {
  readonly locale: Locale;
  readonly returnTo?: string;
  readonly autoFill?: boolean;
  readonly signal?: AbortSignal;
}): Promise<PasskeySignInResult> => {
  const response = await settle(
    requestPasskeySignIn({ autoFill, signal }).then(decodeSignInResponse)
  );
  const result = toPasskeySignInResult(response);
  if (result !== "signed-in") return result;
  const accountId = "data" in response ? response.data?.user.id : undefined;
  if (accountId !== undefined) rememberPasskeyOnThisBrowser(accountId);
  recordSignInCompletion("passkey");
  // A signed-in tab must not show a pending code step after a sign-out.
  forgetEmailSignInRequest();
  if (signal?.aborted) return "cancelled";
  try {
    window.location.replace(getSignInDestination(locale, returnTo));
  } catch {
    // The document is already leaving or the browser blocked navigation.
  }
  return result;
};

/**
 * Confirms a signed-in customer with one of the account's own passkeys. The
 * server then issues a fresh session for the same account, or refuses a
 * passkey of another account and keeps the current session.
 */
export const confirmWithPasskey =
  async (): Promise<PasskeyConfirmationResult> =>
    toPasskeyConfirmationResult(
      await settle(authClient.signIn.passkey().then(decodeChangeResponse))
    );

export type PasskeyCreation =
  | { readonly result: "created"; readonly passkey: AccountPasskey | undefined }
  | { readonly result: Exclude<PasskeyCreationResult, "created"> };

/**
 * Creates a passkey for the signed-in account. The server names it after
 * the authenticator's provider when it knows it.
 */
export const createPasskey = async (
  accountId: string
): Promise<PasskeyCreation> => {
  const response = await settle(
    authClient.passkey.addPasskey().then(decodeCreationResponse)
  );
  // The browser refused because this authenticator already holds one.
  if (response.error?.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    rememberPasskeyOnThisBrowser(accountId);
  }
  const result = toPasskeyCreationResult(response);
  if (result !== "created") return { result };
  rememberPasskeyOnThisBrowser(accountId);
  const created = "data" in response ? response.data : undefined;
  return {
    result,
    passkey: created
      ? {
          id: created.id,
          name: created.name ?? undefined,
          // The server names an unrenamed passkey after its provider.
          provider: undefined,
          createdAt: new Date(created.createdAt).toISOString(),
        }
      : undefined,
  };
};

export const renamePasskey = async (
  id: string,
  name: string
): Promise<PasskeyChangeResult> =>
  toPasskeyChangeResult(
    await settle(
      authClient.passkey.updatePasskey({ id, name }).then(decodeChangeResponse)
    )
  );

export const deletePasskey = async (id: string): Promise<PasskeyChangeResult> =>
  toPasskeyChangeResult(
    await settle(
      authClient.passkey.deletePasskey({ id }).then(decodeChangeResponse)
    )
  );
