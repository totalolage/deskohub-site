import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect, Exit, Layer } from "effect";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import type { CustomerProfile, CustomerProfileSave } from "../contracts";
import { CustomerAccountAccessError } from "../customer-account";
import {
  authenticatedAs,
  failureOf,
  resolvingTo,
  testCustomerSession,
  testLinkedAccount,
} from "./account-operations.test-utils";
import { CustomerProfileService } from "./customer-profile.service";
import {
  completeCurrentCustomerProfile,
  updateCurrentCustomerProfile,
} from "./customer-profile-saving";

const input: CustomerProfileSave = { firstName: "Ada", lastName: "Lovelace" };
const savedProfile: CustomerProfile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: null,
  billing: null,
};
const profileMissing = new CustomerAccountAccessError({
  reason: "link-required",
  linkReason: "not-found",
});

type RunOptions = {
  readonly signedIn?: boolean;
  readonly resolution?: Effect.Effect<
    typeof testLinkedAccount,
    CustomerAccountAccessError
  >;
  readonly referralsReleased?: boolean;
};

type Records = {
  readonly writes: Array<{
    readonly kind: "update" | "create";
    readonly input: CustomerProfileSave;
    readonly signupReferral?: unknown;
  }>;
  readonly codeLookups: string[];
  readonly forgotten: DotyposCustomerId[];
};

/**
 * Fakes for the session, the resolver's answer, the referral release
 * decision and available codes (none), and the remembered referral. They
 * record every profile write, code lookup and forget request.
 */
const fakes = (options: RunOptions, records: Records) =>
  Layer.mergeAll(
    authenticatedAs(options.signedIn === false ? null : testCustomerSession),
    resolvingTo(options.resolution ?? Effect.succeed(testLinkedAccount)),
    Layer.mock(CustomerProfileService, {
      update: (_account, profileInput) =>
        Effect.sync(() => {
          records.writes.push({ kind: "update", input: profileInput });
          return savedProfile;
        }),
      create: (_accountId, profileInput, signupReferral) =>
        Effect.sync(() => {
          records.writes.push({
            kind: "create",
            input: profileInput,
            signupReferral,
          });
          return {
            account: testLinkedAccount,
            profile: savedProfile,
            created: true,
          };
        }),
    }),
    ReferralReleaseGate.fromDecision(options.referralsReleased ?? true),
    ReferralServiceMock({
      findAvailableCode: ({ code }) =>
        Effect.sync(() => {
          records.codeLookups.push(code);
          return undefined;
        }),
    }),
    Layer.mock(ReferralSignupIntentRepository, {}),
    Layer.mock(RememberedReferral, {
      forgetIfSettled: (booker) =>
        Effect.sync(() => {
          if (booker.kind === "account") {
            records.forgotten.push(booker.customerId);
          }
        }),
    })
  );

const run = async <A, E>(
  save: Effect.Effect<A, E, Layer.Success<ReturnType<typeof fakes>>>,
  options: RunOptions = {}
) => {
  const records: Records = { writes: [], codeLookups: [], forgotten: [] };
  const exit = await Effect.runPromiseExit(
    save.pipe(Effect.provide(fakes(options, records)))
  );
  return { exit, ...records };
};

describe("updateCurrentCustomerProfile", () => {
  test("updates the linked customer of the verified session", async () => {
    const { exit, writes } = await run(updateCurrentCustomerProfile(input));

    expect(exit).toEqual(Exit.succeed({ status: "updated" }));
    expect(writes).toEqual([{ kind: "update", input }]);
  });

  test("creates the customer without a referral when no profile matches", async () => {
    const { exit, writes } = await run(updateCurrentCustomerProfile(input), {
      resolution: Effect.fail(profileMissing),
    });

    expect(exit).toEqual(Exit.succeed({ status: "updated" }));
    expect(writes).toEqual([
      { kind: "create", input, signupReferral: undefined },
    ]);
  });

  test("fails unauthenticated without a session and writes nothing", async () => {
    const { exit, writes } = await run(updateCurrentCustomerProfile(input), {
      signedIn: false,
    });

    expect(failureOf(exit)).toEqual(
      new CustomerAccountAccessError({ reason: "unauthenticated" })
    );
    expect(writes).toEqual([]);
  });

  test("passes a blocking resolution failure through and writes nothing", async () => {
    const deletionPending = new CustomerAccountAccessError({
      reason: "link-required",
      linkReason: "deletion-requested",
    });
    const { exit, writes } = await run(updateCurrentCustomerProfile(input), {
      resolution: Effect.fail(deletionPending),
    });

    expect(failureOf(exit)).toEqual(deletionPending);
    expect(writes).toEqual([]);
  });
});

describe("completeCurrentCustomerProfile", () => {
  test("creates the customer and forgets the remembered code once settled", async () => {
    const { exit, writes, forgotten } = await run(
      completeCurrentCustomerProfile(input),
      { resolution: Effect.fail(profileMissing) }
    );

    expect(exit).toEqual(Exit.succeed({ status: "completed" }));
    expect(writes).toEqual([
      { kind: "create", input, signupReferral: undefined },
    ]);
    expect(forgotten).toEqual([testLinkedAccount.dotyposCustomerId]);
  });

  test("saves an already linked customer and ignores the entered code", async () => {
    const { exit, writes, codeLookups } = await run(
      completeCurrentCustomerProfile({ ...input, referralCode: "RFL12345" })
    );

    expect(exit).toEqual(Exit.succeed({ status: "completed" }));
    expect(writes).toEqual([{ kind: "update", input }]);
    expect(codeLookups).toEqual([]);
  });

  test("reports an unusable typed code, creates nothing and keeps the remembered code", async () => {
    const { exit, writes, codeLookups, forgotten } = await run(
      completeCurrentCustomerProfile({ ...input, referralCode: "RFL12345" }),
      { resolution: Effect.fail(profileMissing) }
    );

    expect(exit).toEqual(Exit.succeed({ status: "referral-code-unavailable" }));
    expect(codeLookups).toEqual(["RFL12345"]);
    expect(writes).toEqual([]);
    expect(forgotten).toEqual([]);
  });

  test("ignores the entered code without checking it while referrals are withheld", async () => {
    const { exit, writes, codeLookups } = await run(
      completeCurrentCustomerProfile({ ...input, referralCode: "RFL12345" }),
      { resolution: Effect.fail(profileMissing), referralsReleased: false }
    );

    expect(exit).toEqual(Exit.succeed({ status: "completed" }));
    expect(codeLookups).toEqual([]);
    expect(writes).toEqual([
      { kind: "create", input, signupReferral: undefined },
    ]);
  });
});
