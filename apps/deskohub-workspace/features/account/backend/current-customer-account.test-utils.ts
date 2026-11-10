import { Effect, Layer } from "effect";
import { ReviewAccountsMock } from "@/features/review-accounts/backend/review-accounts.repository.mock";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
} from "../customer-account";
import {
  testCustomerSession,
  testLinkedAccount,
} from "./account-operations.test-utils";
import { CurrentCustomerAccount } from "./current-customer-account";
import type {
  CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";

/** A standing `CurrentCustomerAccount.peek` reports. */
export type PeekedStanding = Effect.Success<
  CurrentCustomerAccount["Service"]["peek"]
>;

const deletionPending = (reviewMarker: "absent" | "present" | "unreadable") =>
  ({
    kind: "deletion-pending",
    session: { ...testCustomerSession, deletionRequested: true },
    reviewMarker,
  }) as const;

const unlinked = (reviewMarker: "absent" | "unreadable") =>
  ({ kind: "unlinked", session: testCustomerSession, reviewMarker }) as const;

const linked = (reviewMarker: "absent" | "unreadable") =>
  ({
    kind: "linked",
    session: testCustomerSession,
    reviewMarker,
    account: testLinkedAccount,
    autoLinked: false,
  }) as const;

/**
 * Every standing `peek` reports for `testCustomerSession`, with each review
 * marker it can carry, by label. A caller's policy test maps each label to
 * its expected outcome, so its table covers every standing.
 */
export const testPeekedStandings = {
  "signed out": { kind: "signed-out" },
  unverified: { kind: "unverified" },
  "awaiting deletion": deletionPending("absent"),
  "awaiting deletion, review marker present": deletionPending("present"),
  "awaiting deletion, review marker unreadable": deletionPending("unreadable"),
  "review account": { kind: "review", session: testCustomerSession },
  unlinked: unlinked("absent"),
  "unlinked, review marker unreadable": unlinked("unreadable"),
  linked: linked("absent"),
  "linked, review marker unreadable": linked("unreadable"),
  "link unavailable": {
    kind: "unavailable",
    session: testCustomerSession,
    reviewMarker: "absent",
    failure: customerAccountUnavailable("account-link.read"),
  },
} satisfies Record<string, PeekedStanding>;

export type TestPeekedStandingLabel = keyof typeof testPeekedStandings;

/** The labels of `testPeekedStandings`, for `test.each`. */
export const testPeekedStandingLabels = Object.keys(
  testPeekedStandings
) as readonly TestPeekedStandingLabel[];

/**
 * The standing module answering `peek` with `standing`, or failing it with
 * the session read's error; every other member dies, so a reader that
 * resolves or requires an active account fails the test.
 */
export const peeking = (
  standing: PeekedStanding | CustomerAccountAccessError,
  calls: { peeks: number } = { peeks: 0 }
) =>
  Layer.mock(CurrentCustomerAccount, {
    peek: Effect.suspend(() => {
      calls.peeks += 1;
      return standing instanceof CustomerAccountAccessError
        ? Effect.fail(standing)
        : Effect.succeed(standing);
    }),
  });

/** A standing `CurrentCustomerAccount.resolve` reports. */
export type ResolvedStanding = Effect.Success<
  CurrentCustomerAccount["Service"]["resolve"]
>;

const resolvedUnavailable = (failure: CustomerAccountAccessError) =>
  ({
    kind: "unavailable",
    session: testCustomerSession,
    reviewMarker: "absent",
    failure,
  }) as const;

const supportRequired = (reason: "ambiguous" | "unusable" | "claimed") =>
  ({
    kind: "support-required",
    reason,
    session: testCustomerSession,
    reviewMarker: "absent",
  }) as const;

/**
 * Every standing `resolve` reports for `testCustomerSession`, by label,
 * including the refusals the locked recheck carries on `unavailable`. A
 * caller's policy test maps each label to its expected outcome.
 */
export const testResolvedStandings = {
  "signed out": { kind: "signed-out" },
  unverified: { kind: "unverified" },
  "awaiting deletion": deletionPending("absent"),
  "awaiting deletion, review marker present": deletionPending("present"),
  "awaiting deletion, review marker unreadable": deletionPending("unreadable"),
  "review account": { kind: "review", session: testCustomerSession },
  "profile missing": {
    kind: "profile-missing",
    session: testCustomerSession,
    reviewMarker: "absent",
  },
  "support required, ambiguous": supportRequired("ambiguous"),
  "support required, unusable": supportRequired("unusable"),
  "support required, claimed": supportRequired("claimed"),
  linked: linked("absent"),
  "linked, review marker unreadable": linked("unreadable"),
  "linked by this resolution": { ...linked("absent"), autoLinked: true },
  "lock unavailable": resolvedUnavailable(
    customerAccountUnavailable("account-link.lock")
  ),
  "Dotypos lookup unavailable": resolvedUnavailable(
    customerAccountUnavailable("dotypos.customer-lookup")
  ),
  "deletion found under the lock": resolvedUnavailable(
    new CustomerAccountAccessError({
      reason: "link-required",
      linkReason: "deletion-requested",
    })
  ),
  "unverified email found under the lock": resolvedUnavailable(
    new CustomerAccountAccessError({ reason: "unverified-email" })
  ),
} satisfies Record<string, ResolvedStanding>;

export type TestResolvedStandingLabel = keyof typeof testResolvedStandings;

/** The labels of `testResolvedStandings`, for `test.each`. */
export const testResolvedStandingLabels = Object.keys(
  testResolvedStandings
) as readonly TestResolvedStandingLabel[];

type Answer<A> = A | CustomerAccountAccessError;

const answer = <A>(value: Answer<A>) =>
  value instanceof CustomerAccountAccessError
    ? Effect.fail(value)
    : Effect.succeed(value);

/**
 * The standing module answering only the members given, each with its
 * value or failing with the session read's error, and counting each call;
 * every other member dies, so a reader that uses another fails the test.
 */
export const answeringStanding = (
  answers: {
    readonly resolve?: Answer<ResolvedStanding>;
    readonly requireActive?: Answer<CustomerAccountSession>;
  },
  calls: { resolutions: number; activeReads: number } = {
    resolutions: 0,
    activeReads: 0,
  }
) => {
  const { resolve, requireActive } = answers;
  return Layer.mock(CurrentCustomerAccount, {
    ...(resolve !== undefined && {
      resolve: Effect.suspend(() => {
        calls.resolutions += 1;
        return answer(resolve);
      }),
    }),
    ...(requireActive !== undefined && {
      requireActive: Effect.suspend(() => {
        calls.activeReads += 1;
        return answer(requireActive);
      }),
    }),
  });
};

/**
 * The real `requireActive` over `authentication`, for a reader that only
 * requires an active session; `peek` and `resolve` report links unavailable,
 * and a review marker read dies.
 */
export const requiringActiveOver = <E, R>(
  authentication: Layer.Layer<CustomerAuthentication, E, R>
) =>
  CurrentCustomerAccount.LinksUnavailable.pipe(
    Layer.provide(Layer.mergeAll(authentication, ReviewAccountsMock({})))
  );
