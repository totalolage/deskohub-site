import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect } from "effect";
import type { ReferralSignupIntent } from "@/features/referrals/signup-intent.repository";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountUnavailable,
  type LinkedCustomerAccount,
  mapCustomerAccountFailure,
} from "../customer-account";
import type {
  CustomerAccountLinkClaim,
  CustomerAccountLinkError,
} from "./customer-account-link.repository";
import { HeldCustomerAccount } from "./customer-account-sections";
import type {
  DotyposCustomerError,
  ExactEmailCustomerMatch,
} from "./customer-dotypos-adapter.service";

const accessError = (
  reason: CustomerAccountAccessError["reason"],
  linkReason?: CustomerAccountAccessError["linkReason"]
) =>
  linkReason
    ? new CustomerAccountAccessError({ reason, linkReason })
    : new CustomerAccountAccessError({ reason });

/** The reads and writes the held resolution steps run through. */
export type HeldCustomerAccountLinkSteps = {
  readonly findLink: (
    accountId: CustomerAccountId
  ) => Effect.Effect<DotyposCustomerId | null, CustomerAccountLinkError>;
  /**
   * Whether the account is an app-directory review account, which never
   * links or creates a Dotypos customer.
   */
  readonly isReviewAccount: (
    accountId: CustomerAccountId
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly classify: (
    email: string
  ) => Effect.Effect<ExactEmailCustomerMatch, DotyposCustomerError>;
  readonly claimLink: (
    accountId: CustomerAccountId,
    customerId: DotyposCustomerId,
    signupReferral?: ReferralSignupIntent
  ) => Effect.Effect<CustomerAccountLinkClaim, CustomerAccountLinkError>;
  readonly reactivate: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<void, DotyposCustomerError>;
};

/**
 * How the current account resolved. `autoLinked` is true only when this
 * resolution itself claimed the link to an existing exact-email Dotypos
 * customer; an existing link, including one created by profile completion,
 * reports false.
 */
export type CustomerAccountLinkResolution = {
  readonly account: LinkedCustomerAccount;
  readonly autoLinked: boolean;
};

/**
 * Resolution steps for the account the enclosing section holds: an existing
 * link wins, then one usable exact-email Dotypos customer is reactivated if
 * expired and claimed. No match fails with `not-found`, which leaves profile
 * creation to the caller; every other outcome is the support state. A signup
 * referral is written with the link only when this claim creates it.
 */
export const resolveHeldCustomerAccountLink = Effect.fn(
  "account.resolveHeldCustomerAccountLink"
)(function* (
  dependencies: HeldCustomerAccountLinkSteps,
  signupReferral?: ReferralSignupIntent
) {
  const identity = yield* HeldCustomerAccount;
  const existingCustomerId = yield* dependencies
    .findLink(identity.accountId)
    .pipe(Effect.mapError(mapCustomerAccountFailure("account-link.read")));
  if (existingCustomerId) {
    return {
      account: {
        accountId: identity.accountId,
        dotyposCustomerId: existingCustomerId,
      },
      autoLinked: false,
    } satisfies CustomerAccountLinkResolution;
  }

  // A review account books in its sandbox, so no lookup ever reaches Dotypos.
  const reviewAccount = yield* dependencies
    .isReviewAccount(identity.accountId)
    .pipe(Effect.mapError(mapCustomerAccountFailure("account-link.read")));
  if (reviewAccount) {
    return yield* customerAccountUnavailable("account.review");
  }

  const match = yield* dependencies
    .classify(identity.email)
    .pipe(
      Effect.mapError(mapCustomerAccountFailure("dotypos.customer-lookup"))
    );
  if (match.kind !== "matched") {
    return yield* accessError("link-required", match.kind);
  }

  if (match.state === "expired") {
    yield* dependencies
      .reactivate(match.customerId)
      .pipe(
        Effect.mapError(
          mapCustomerAccountFailure("dotypos.customer-expiration")
        )
      );
  }

  const claimed = yield* dependencies
    .claimLink(identity.accountId, match.customerId, signupReferral)
    .pipe(Effect.mapError(mapCustomerAccountFailure("account-link.claim")));
  if (claimed.kind === "claimed") {
    return yield* accessError("link-required", "claimed");
  }

  return {
    account: {
      accountId: identity.accountId,
      dotyposCustomerId: claimed.customerId,
    },
    autoLinked: true,
  } satisfies CustomerAccountLinkResolution;
});
