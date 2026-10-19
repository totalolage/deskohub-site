"use client";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { getPasskeyAssertion } from "@/shared/browser/webauthn-assertion";
import { authClient } from "./auth.client";

/*
 * Runs passkey sign-ins through the Better Auth passkey endpoints, one at a
 * time per page. The browser runs one WebAuthn request at a time, and every
 * options request replaces the single sign-in challenge cookie the server
 * verifies against, so overlapping attempts make each other fail. The plugin
 * client's `signIn.passkey` can't be cancelled: it takes no abort signal for
 * its options request or its ceremony.
 */

type PasskeySignInError = { readonly code?: string };

/** Better Auth's `{ data, error }` result of a passkey sign-in. */
export type PasskeySignInResponse = {
  readonly data: unknown;
  readonly error: PasskeySignInError | null;
};

type Attempt = {
  readonly autoFill: boolean;
  readonly controller: AbortController;
};

/** The attempt that may still send a request or start a ceremony. */
let current: Attempt | undefined;

const cancelled = { data: null, error: { code: "AUTH_CANCELLED" } } as const;

/**
 * The browser's reasons for a ceremony that ended without a passkey: the
 * customer closed the prompt or let it time out, or it was aborted.
 */
const cancelledCeremonyErrors = new Set(["AbortError", "NotAllowedError"]);

const ceremonyFailure = (cause: unknown) =>
  cause instanceof DOMException && cancelledCeremonyErrors.has(cause.name)
    ? cancelled
    : ({ data: null, error: { code: "PASSKEY_CEREMONY_FAILED" } } as const);

/**
 * Signs in with a passkey, from a button or, with `autoFill`, from the
 * autofill of a `webauthn` field, and resolves the Better Auth `{ data,
 * error }` response the way `signIn.passkey` does.
 *
 * A new attempt first aborts the one before it, its pending options request
 * and ceremony included, so the cancelled request can't set the challenge
 * cookie after the new one's. An autofill attempt never replaces one the
 * customer started; it resolves as cancelled instead. An attempt cancelled
 * by `signal` or a newer attempt resolves as cancelled and sends no further
 * request, whatever its pending requests resolve with. Once the verification
 * succeeds the session exists, so a later cancellation, even one the session
 * signal triggers, still resolves the sign-in; the caller rechecks `signal`.
 */
export const requestPasskeySignIn = async ({
  autoFill,
  signal,
}: {
  readonly autoFill: boolean;
  readonly signal?: AbortSignal;
}): Promise<PasskeySignInResponse> => {
  if (signal?.aborted || (autoFill && current?.autoFill === false)) {
    return cancelled;
  }
  current?.controller.abort();
  const attempt: Attempt = { autoFill, controller: new AbortController() };
  current = attempt;
  const attemptSignal = attempt.controller.signal;
  const cancel = () => attempt.controller.abort();
  signal?.addEventListener("abort", cancel);
  try {
    const options = await authClient.$fetch<
      PublicKeyCredentialRequestOptionsJSON,
      PasskeySignInError
    >("/passkey/generate-authenticate-options", {
      method: "GET",
      signal: attemptSignal,
      throw: false,
    });
    attemptSignal.throwIfAborted();
    if (!options.data) return options;
    let assertion: Awaited<ReturnType<typeof getPasskeyAssertion>>;
    try {
      assertion = await getPasskeyAssertion(options.data, {
        conditional: autoFill,
        signal: attemptSignal,
      });
    } catch (cause) {
      attemptSignal.throwIfAborted();
      return ceremonyFailure(cause);
    }
    attemptSignal.throwIfAborted();
    const verified = await authClient.$fetch<unknown, PasskeySignInError>(
      "/passkey/verify-authentication",
      {
        method: "POST",
        body: { response: assertion },
        signal: attemptSignal,
        throw: false,
      }
    );
    attemptSignal.throwIfAborted();
    if (verified.error === null) authClient.$store.notify("$sessionSignal");
    return verified;
  } catch (cause) {
    if (attemptSignal.aborted) return cancelled;
    throw cause;
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (current === attempt) current = undefined;
  }
};
