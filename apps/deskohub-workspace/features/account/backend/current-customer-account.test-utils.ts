import { Effect, Layer } from "effect";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
} from "../customer-account";
import {
  testCustomerSession,
  testLinkedAccount,
} from "./account-operations.test-utils";
import { CurrentCustomerAccount } from "./current-customer-account";

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
