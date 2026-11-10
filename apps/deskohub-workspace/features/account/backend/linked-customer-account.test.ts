import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
  type LinkedCustomerAccount,
} from "../customer-account";
import { failureOf, testLinkedAccount } from "./account-operations.test-utils";
import {
  answeringStanding,
  type TestResolvedStandingLabel,
  testResolvedStandingLabels,
  testResolvedStandings,
} from "./current-customer-account.test-utils";
import { requireLinkedCustomerAccount } from "./linked-customer-account";

const accessError = (
  reason: CustomerAccountAccessError["reason"],
  linkReason?: CustomerAccountAccessError["linkReason"]
) =>
  linkReason
    ? new CustomerAccountAccessError({ reason, linkReason })
    : new CustomerAccountAccessError({ reason });

/**
 * What `CustomerAccountResolver.resolve` answered for each standing before
 * the standing existed: the linked account, or its exact failure.
 */
const resolverAnswer = {
  "signed out": accessError("unauthenticated"),
  unverified: accessError("unverified-email"),
  "awaiting deletion": accessError("link-required", "deletion-requested"),
  "awaiting deletion, review marker present": accessError(
    "link-required",
    "deletion-requested"
  ),
  "awaiting deletion, review marker unreadable": accessError(
    "link-required",
    "deletion-requested"
  ),
  "review account": customerAccountUnavailable("account.review"),
  "profile missing": accessError("link-required", "not-found"),
  "support required, ambiguous": accessError("link-required", "ambiguous"),
  "support required, unusable": accessError("link-required", "unusable"),
  "support required, claimed": accessError("link-required", "claimed"),
  linked: testLinkedAccount,
  "linked, review marker unreadable": testLinkedAccount,
  "linked by this resolution": testLinkedAccount,
  "lock unavailable": customerAccountUnavailable("account-link.lock"),
  "Dotypos lookup unavailable": customerAccountUnavailable(
    "dotypos.customer-lookup"
  ),
  "deletion found under the lock": accessError(
    "link-required",
    "deletion-requested"
  ),
  "unverified email found under the lock": accessError("unverified-email"),
} satisfies Record<
  TestResolvedStandingLabel,
  LinkedCustomerAccount | CustomerAccountAccessError
>;

/** The fields callers read from an access error, compared field by field. */
const facts = (error: CustomerAccountAccessError) => ({
  tag: error._tag,
  reason: error.reason,
  linkReason: error.linkReason,
  code: error.cause?.code,
  diagnostic: error.diagnostic,
});

const run = (answer: Parameters<typeof answeringStanding>[0]["resolve"]) =>
  Effect.runPromiseExit(
    requireLinkedCustomerAccount.pipe(
      Effect.provide(answeringStanding({ resolve: answer }))
    )
  );

describe("requireLinkedCustomerAccount", () => {
  test.each(testResolvedStandingLabels)(
    "answers %s as the resolver did",
    async (label) => {
      const expected = resolverAnswer[label];
      const exit = await run(testResolvedStandings[label]);

      if (expected instanceof CustomerAccountAccessError) {
        expect(facts(failureOf(exit) as CustomerAccountAccessError)).toEqual(
          facts(expected)
        );
      } else {
        expect(exit).toEqual(Exit.succeed(expected));
      }
    }
  );

  test.each([
    accessError("not-configured"),
    accessError("unauthenticated"),
    customerAccountUnavailable("authentication.session"),
  ])("fails with the session read's own error", async (error) => {
    expect(failureOf(await run(error))).toBe(error);
  });
});
