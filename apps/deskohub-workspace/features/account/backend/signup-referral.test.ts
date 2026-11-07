import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import type { CustomerAccountId } from "../customer-account";
import { CustomerAccountAccessError } from "../customer-account";
import { AccountFeatureWithheldError } from "./account-feature-withheld";
import {
  failureOf,
  resolvingTo,
  testLinkedAccount,
} from "./account-operations.test-utils";
import { acknowledgeCurrentSignupReferral } from "./signup-referral";

/**
 * Runs the acknowledgement under the referral release decision against a
 * resolver answering `resolution`; records every acknowledged account.
 */
const run = async (options: {
  readonly referralsReleased?: boolean;
  readonly resolution?: Effect.Effect<
    typeof testLinkedAccount,
    CustomerAccountAccessError
  >;
}) => {
  const acknowledged: CustomerAccountId[] = [];
  const resolutions = { count: 0 };
  const exit = await Effect.runPromiseExit(
    acknowledgeCurrentSignupReferral().pipe(
      Effect.provide(
        Layer.mergeAll(
          ReferralReleaseGate.fromDecision(options.referralsReleased ?? true),
          resolvingTo(
            options.resolution ?? Effect.succeed(testLinkedAccount),
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

  test("passes a resolution failure through and acknowledges nothing", async () => {
    const deletionPending = new CustomerAccountAccessError({
      reason: "link-required",
      linkReason: "deletion-requested",
    });
    const { exit, acknowledged } = await run({
      resolution: Effect.fail(deletionPending),
    });

    expect(failureOf(exit)).toEqual(deletionPending);
    expect(acknowledged).toEqual([]);
  });

  test("refuses while referrals are withheld and leaves the outcome untouched", async () => {
    const { exit, acknowledged, resolutions } = await run({
      referralsReleased: false,
    });

    expect(failureOf(exit)).toEqual(
      new AccountFeatureWithheldError({ feature: "referrals" })
    );
    expect(resolutions.count).toBe(0);
    expect(acknowledged).toEqual([]);
  });
});
