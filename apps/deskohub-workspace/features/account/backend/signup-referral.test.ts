import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import type { CustomerAccountId } from "../customer-account";
import { CustomerAccountAccessError } from "../customer-account";
import { AccountFeatureWithheldError } from "./account-feature-withheld";
import { failureOf, testLinkedAccount } from "./account-operations.test-utils";
import {
  answeringStanding,
  type ResolvedStanding,
  testResolvedStandings,
} from "./current-customer-account.test-utils";
import { acknowledgeCurrentSignupReferral } from "./signup-referral";

/**
 * Runs the acknowledgement under the referral release decision against a
 * standing resolving to `standing`; records every acknowledged account.
 */
const run = async (options: {
  readonly referralsReleased?: boolean;
  readonly standing?: ResolvedStanding;
}) => {
  const acknowledged: CustomerAccountId[] = [];
  const resolutions = { resolutions: 0, activeReads: 0 };
  const exit = await Effect.runPromiseExit(
    acknowledgeCurrentSignupReferral().pipe(
      Effect.provide(
        Layer.mergeAll(
          ReferralReleaseGate.fromDecision(options.referralsReleased ?? true),
          answeringStanding(
            { resolve: options.standing ?? testResolvedStandings.linked },
            resolutions
          ),
          Layer.mock(ReferralSignupIntentRepository, {
            acknowledge: (accountId) =>
              Effect.sync(() => {
                acknowledged.push(accountId);
              }),
          })
        )
      )
    )
  );
  return { exit, acknowledged, resolutions };
};

describe("acknowledgeCurrentSignupReferral", () => {
  test("acknowledges the resolved session account's signup referral", async () => {
    const { exit, acknowledged } = await run({});

    expect(exit).toEqual(Exit.succeed({ status: "acknowledged" }));
    expect(acknowledged).toEqual([testLinkedAccount.accountId]);
  });

  test("refuses a standing without a linked account with the resolver's failure and acknowledges nothing", async () => {
    const { exit, acknowledged } = await run({
      standing: testResolvedStandings["awaiting deletion"],
    });

    expect(failureOf(exit)).toEqual(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "deletion-requested",
      })
    );
    expect(acknowledged).toEqual([]);
  });

  test("refuses while referrals are withheld and leaves the outcome untouched", async () => {
    const { exit, acknowledged, resolutions } = await run({
      referralsReleased: false,
    });

    expect(failureOf(exit)).toEqual(
      new AccountFeatureWithheldError({ feature: "referrals" })
    );
    expect(resolutions.resolutions).toBe(0);
    expect(acknowledged).toEqual([]);
  });
});
