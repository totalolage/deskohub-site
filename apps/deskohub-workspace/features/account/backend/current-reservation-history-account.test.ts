import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "../customer-account";
import { testLinkedAccount } from "./account-operations.test-utils";
import {
  type PeekedStanding,
  peeking,
  type TestPeekedStandingLabel,
  testPeekedStandingLabels,
  testPeekedStandings,
} from "./current-customer-account.test-utils";
import { currentReservationHistoryAccount } from "./current-reservation-history-account";
import type { ReservationHistoryAccount } from "./customer-reservation-history.service";

// The account the caller asks for: the grant's or the session's.
const requestedAccountId = customerAccountIdSchema.make("requested-account");

const readWith = (standing: PeekedStanding | CustomerAccountAccessError) =>
  currentReservationHistoryAccount(requestedAccountId).pipe(
    Effect.provide(peeking(standing)),
    Effect.result,
    Effect.runPromise
  );

/** What the history reads for a standing. */
type HistoryOutcome =
  | { readonly account: ReservationHistoryAccount }
  | { readonly failure: CustomerAccountAccessError };

describe("currentReservationHistoryAccount", () => {
  const authoredOnly = { accountId: requestedAccountId };
  // The history's policy, one row per standing `peek` reports.
  const expected = {
    "signed out": { account: authoredOnly },
    unverified: {
      failure: new CustomerAccountAccessError({ reason: "unverified-email" }),
    },
    "awaiting deletion": { account: authoredOnly },
    "awaiting deletion, review marker present": { account: authoredOnly },
    "awaiting deletion, review marker unreadable": { account: authoredOnly },
    "review account": { account: authoredOnly },
    unlinked: { account: authoredOnly },
    "unlinked, review marker unreadable": { account: authoredOnly },
    // Including the linked customer's own reservations.
    linked: { account: testLinkedAccount },
    "linked, review marker unreadable": { account: testLinkedAccount },
    "link unavailable": {
      failure: customerAccountUnavailable("account-link.read"),
    },
  } satisfies Record<TestPeekedStandingLabel, HistoryOutcome>;

  test.each(testPeekedStandingLabels)(
    "answers the standing %s with its own history account",
    async (label) => {
      const result = await readWith(testPeekedStandings[label]);
      const row = expected[label];

      expect(result).toEqual(
        "account" in row
          ? Result.succeed(row.account)
          : Result.fail(row.failure)
      );
    }
  );

  test("fails with the session read's error", async () => {
    const failure = customerAccountUnavailable("authentication.session");

    expect(await readWith(failure)).toEqual(Result.fail(failure));
  });
});
