import { createHash } from "node:crypto";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Data, Effect, Option, Schema } from "effect";
import type {
  CustomerAccountId,
  LinkedCustomerAccount,
} from "@/features/account/customer-account";

/**
 * The cookie adapter uses this value when a management cookie exists but is
 * not a usable opaque credential. It is deliberately handled before either
 * credential or account resolution so an invalid link can never fall through
 * to the signed-in account.
 */
export const MARKETING_MANAGEMENT_INVALID_COOKIE_SENTINEL = "invalid" as const;

export type MarketingManagementCookies = {
  readonly pending: string | undefined;
  readonly session: string | undefined;
};

export type MarketingManagementSource = "link" | "account";

export type MarketingPreferencesAuthority =
  | {
      readonly kind: "pending";
      readonly rawPending: string;
      readonly context: string;
    }
  | {
      readonly kind: "link";
      readonly source: "link";
      readonly rawSession: string;
      readonly customerId: DotyposCustomerId;
      readonly context: string;
    }
  | {
      readonly kind: "account";
      readonly source: "account";
      readonly accountId: CustomerAccountId;
      readonly customerId: DotyposCustomerId;
      readonly context: string;
    };

export type MarketingPreferencesAuthorityFailureReason =
  | "invalid-link"
  | "unavailable";

export class MarketingPreferencesAuthorityError extends Data.TaggedError(
  "MarketingPreferencesAuthorityError"
)<{
  readonly reason: MarketingPreferencesAuthorityFailureReason;
}> {}

export interface MarketingPreferencesAuthorityDependencies {
  readonly resolveAccount: () => Effect.Effect<LinkedCustomerAccount, unknown>;
  readonly resolveManagementSession: (
    rawSession: string
  ) => Effect.Effect<DotyposCustomerId, unknown>;
}

/**
 * Resolves the one authority allowed to manage a marketing preference.
 * Pending links deliberately stop here: they are represented to the page but
 * are not exchanged until the user explicitly confirms the operation.
 */
export const resolveMarketingPreferencesAuthority = (
  cookies: MarketingManagementCookies,
  dependencies: MarketingPreferencesAuthorityDependencies
): Effect.Effect<
  MarketingPreferencesAuthority,
  MarketingPreferencesAuthorityError
> => {
  if (cookies.pending !== undefined) {
    if (isInvalidCookieValue(cookies.pending)) {
      return Effect.fail(invalidLink());
    }

    return Effect.succeed({
      kind: "pending",
      rawPending: cookies.pending,
      context: getPendingMarketingManagementContext(cookies.pending),
    });
  }

  if (cookies.session !== undefined) {
    return resolveMarketingLinkAuthority(
      cookies.session,
      dependencies.resolveManagementSession
    );
  }

  return dependencies.resolveAccount().pipe(
    Effect.map(
      ({ accountId, dotyposCustomerId }): MarketingPreferencesAuthority => ({
        kind: "account",
        source: "account",
        accountId,
        customerId: dotyposCustomerId,
        context: getAccountMarketingManagementContext(
          accountId,
          dotyposCustomerId
        ),
      })
    ),
    Effect.mapError(() => unavailable())
  );
};

/**
 * Resolves a management session without considering a pending cookie. Clear
 * needs this narrow operation so it can revoke an already active session even
 * when a pending link is also present in the browser.
 */
export const resolveMarketingLinkAuthority = (
  rawSession: string,
  resolveManagementSession: MarketingPreferencesAuthorityDependencies["resolveManagementSession"]
): Effect.Effect<
  Extract<MarketingPreferencesAuthority, { readonly kind: "link" }>,
  MarketingPreferencesAuthorityError
> => {
  if (isInvalidCookieValue(rawSession)) {
    return Effect.fail(invalidLink());
  }

  return resolveManagementSession(rawSession).pipe(
    Effect.map(
      (
        customerId
      ): Extract<MarketingPreferencesAuthority, { readonly kind: "link" }> => ({
        kind: "link",
        source: "link",
        rawSession,
        customerId,
        context: getLinkMarketingManagementContext(rawSession, customerId),
      })
    ),
    Effect.mapError(mapManagementResolutionFailure)
  );
};

export const getPendingMarketingManagementContext = (
  rawPending: string
): string => hashContext(`pending\0${rawPending}`);

export const getLinkMarketingManagementContext = (
  rawSession: string,
  customerId: DotyposCustomerId
): string => hashContext(`link\0${rawSession}\0${customerId}`);

export const getAccountMarketingManagementContext = (
  accountId: CustomerAccountId,
  customerId: DotyposCustomerId
): string => hashContext(`account\0${accountId}\0${customerId}`);

export const getMarketingManagementDismissalContext = (
  cookies: MarketingManagementCookies
): string =>
  hashContext(
    `marketing-dismissal\0${JSON.stringify({
      pending: cookies.pending ?? null,
      session: cookies.session ?? null,
    })}`
  );

export const matchesMarketingManagementContext = (
  authority: MarketingPreferencesAuthority,
  source: MarketingManagementSource,
  context: string
): authority is Extract<
  MarketingPreferencesAuthority,
  { readonly kind: "link" | "account" }
> =>
  authority.kind === source &&
  "source" in authority &&
  authority.source === source &&
  authority.context === context;

const hashContext = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

const isInvalidCookieValue = (value: string): boolean =>
  value.length === 0 || value === MARKETING_MANAGEMENT_INVALID_COOKIE_SENTINEL;

const mapManagementResolutionFailure = (
  cause: unknown
): MarketingPreferencesAuthorityError =>
  hasManagementFailureReason(cause, "invalid_credential")
    ? invalidLink()
    : unavailable();

const managementFailureReasonSchema = Schema.TaggedStruct(
  "MarketingManagementError",
  {
    reason: Schema.Literals(["invalid_credential", "unavailable"]),
  }
);

const hasManagementFailureReason = (
  cause: unknown,
  reason: "invalid_credential" | "unavailable"
): boolean =>
  Option.getOrUndefined(
    Schema.decodeUnknownOption(managementFailureReasonSchema)(cause)
  )?.reason === reason;

const invalidLink = (): MarketingPreferencesAuthorityError =>
  new MarketingPreferencesAuthorityError({ reason: "invalid-link" });

const unavailable = (): MarketingPreferencesAuthorityError =>
  new MarketingPreferencesAuthorityError({ reason: "unavailable" });
