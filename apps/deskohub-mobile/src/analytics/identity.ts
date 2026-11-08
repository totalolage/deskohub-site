/**
 * Who analytics attributes events to. `pending` holds delivery and flag reads
 * until the app knows whether someone is signed in; `anonymous` and
 * `authenticated` are settled.
 */
export type AnalyticsIdentity =
  | { readonly kind: "pending" }
  | { readonly kind: "anonymous" }
  | {
      readonly kind: "authenticated";
      readonly accountId: string;
      /** A test or staff account, marked internal so reports can exclude it. */
      readonly testAccount: boolean;
    };

export type SettledAnalyticsIdentity = Exclude<
  AnalyticsIdentity,
  { readonly kind: "pending" }
>;

/** The PostHog distinct ID of a customer account, the same on the site. */
export const analyticsDistinctId = (accountId: string): string =>
  `workspace-account:${accountId}`;

/** The distinct ID a client is identified as, or `null` while anonymous. */
export type AppliedDistinctId = string | null;

export type IdentityStep =
  | { readonly kind: "reset" }
  | { readonly kind: "identify"; readonly distinctId: string };

/**
 * The client calls that move a client from the identity it was identified as
 * to the next settled one. Identifying from anonymous keeps the anonymous
 * history; a different account or signing out resets first.
 */
export const identitySteps = (
  applied: AppliedDistinctId,
  next: SettledAnalyticsIdentity
): readonly IdentityStep[] => {
  const desired =
    next.kind === "authenticated" ? analyticsDistinctId(next.accountId) : null;
  if (desired === applied) return [];
  const reset: readonly IdentityStep[] =
    applied === null ? [] : [{ kind: "reset" }];
  return desired === null
    ? reset
    : [...reset, { kind: "identify", distinctId: desired }];
};
