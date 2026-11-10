import "@/shared/polyfills/temporal";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import type { CustomerAccountId } from "../customer-account";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";

/**
 * The Better Auth profile facts of a synthetic verified session: no saved
 * name and fixed account timestamps.
 */
export const testSessionProfile = {
  displayName: null,
  accountCreatedAt: Temporal.Instant.from("2026-01-05T09:00:00Z"),
  accountUpdatedAt: Temporal.Instant.from("2026-01-05T09:00:00Z"),
} as const satisfies Pick<
  CustomerAccountSession,
  "displayName" | "accountCreatedAt" | "accountUpdatedAt"
>;

/** A verified session for this account. */
const signedInSession = (
  accountId: CustomerAccountId,
  session: { readonly deletionRequested?: boolean } = {}
): CustomerAccountSession => ({
  accountId,
  email: testEmailAddress("signed-in-account"),
  deletionRequested: session.deletionRequested ?? false,
  ...testSessionProfile,
});

/**
 * Authentication whose session is this account. `beforeRead` runs first on
 * every read, so a test can hold the read at a gate.
 */
export const signedInAuthentication = (
  accountId: CustomerAccountId,
  options: {
    readonly beforeRead?: Effect.Effect<void>;
    readonly deletionRequested?: boolean;
  } = {}
) =>
  Layer.succeed(CustomerAuthentication, {
    currentUser: (options.beforeRead ?? Effect.void).pipe(
      Effect.as(signedInSession(accountId, options))
    ),
  });

/**
 * The real, configured authentication adapter whose session read rejects, as
 * when the session store can't be reached. It fails closed with the account
 * contract's sanitized `unavailable` reason.
 */
export const unreachableSessionAuthentication =
  CustomerAuthentication.fromEnvironment({
    readBetterAuthSecretsRaw: () =>
      "1:test-only-strong-secret-value-9f2c7a41b8e6d530417c",
    readCurrentSession: () =>
      Promise.reject(new Error("The session store could not be reached.")),
  });
