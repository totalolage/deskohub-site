import { describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import type { AccountCustomerLinkResponse } from "../account-customer-link";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
} from "../customer-account";
import { accountCustomerLinkFor } from "./account-customer-link";
import {
  testCustomerSession,
  testLinkedAccount,
} from "./account-operations.test-utils";
import {
  type TestPeekedStandingLabel,
  testPeekedStandingLabels,
  testPeekedStandings,
} from "./current-customer-account.test-utils";

/** What the route answers for a standing. */
type LinkOutcome =
  | { readonly link: AccountCustomerLinkResponse }
  | { readonly failure: CustomerAccountAccessError };

describe("accountCustomerLinkFor", () => {
  const noCustomer = {
    accountId: testCustomerSession.accountId,
    dotyposCustomerId: null,
  };
  // The customer-link route's policy, one row per standing `peek` reports.
  // A failure answers 503.
  const expected = {
    "signed out": { link: { accountId: null, dotyposCustomerId: null } },
    unverified: {
      failure: new CustomerAccountAccessError({ reason: "unverified-email" }),
    },
    "awaiting deletion": { link: noCustomer },
    "awaiting deletion, review marker present": { link: noCustomer },
    "awaiting deletion, review marker unreadable": { link: noCustomer },
    "review account": { link: noCustomer },
    unlinked: { link: noCustomer },
    "unlinked, review marker unreadable": { link: noCustomer },
    linked: { link: testLinkedAccount },
    "linked, review marker unreadable": { link: testLinkedAccount },
    "link unavailable": {
      failure: customerAccountUnavailable("account-link.read"),
    },
  } satisfies Record<TestPeekedStandingLabel, LinkOutcome>;

  test.each(testPeekedStandingLabels)(
    "answers the standing %s with its own link",
    async (label) => {
      const result = await accountCustomerLinkFor(
        testPeekedStandings[label]
      ).pipe(Effect.result, Effect.runPromise);
      const row = expected[label];

      expect(result).toEqual(
        "link" in row ? Result.succeed(row.link) : Result.fail(row.failure)
      );
    }
  );

  test("carries only identifiers", async () => {
    const link = await Effect.runPromise(
      accountCustomerLinkFor(testPeekedStandings.linked)
    );

    expect(Object.keys(link).sort()).toEqual([
      "accountId",
      "dotyposCustomerId",
    ]);
    expect(JSON.stringify(link)).not.toContain("@");
  });
});
