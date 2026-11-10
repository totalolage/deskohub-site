import { expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { CustomerAccountAccessError } from "../customer-account";
import {
  testCustomerSession,
  testLinkedAccount,
} from "./account-operations.test-utils";
import {
  answeringStanding,
  type ResolvedStanding,
  testResolvedStandingLabels,
  testResolvedStandings,
} from "./current-customer-account.test-utils";
import {
  type CustomerAccountActivityState,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import { CustomerAccountReservationOwnership } from "./customer-account-reservation-ownership";
import type { CustomerAccountSession } from "./customer-authentication.service";
import { linkedAccountFailure } from "./linked-customer-account";

const provideOwnership = (options: {
  readonly standing?: ResolvedStanding;
  readonly active?: CustomerAccountSession | CustomerAccountAccessError;
  readonly activity?: CustomerAccountActivityState;
}) => {
  const activity = options.activity ?? {
    kind: "active",
    email: testEmailAddress("owner"),
    deletionRequestedAt: null,
  };

  return CustomerAccountReservationOwnership.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        answeringStanding({
          resolve: options.standing ?? testResolvedStandings.linked,
          requireActive: options.active ?? testCustomerSession,
        }),
        Layer.mock(CustomerAccountLinkRepository, {
          findActivityState: () => Effect.succeed(activity),
        })
      )
    )
  );
};

const run = (options: Parameters<typeof provideOwnership>[0]) =>
  Effect.gen(function* () {
    const ownership = yield* CustomerAccountReservationOwnership;
    return yield* ownership.resolve;
  }).pipe(Effect.provide(provideOwnership(options)));

const runActiveAccountId = (options: Parameters<typeof provideOwnership>[0]) =>
  Effect.gen(function* () {
    const ownership = yield* CustomerAccountReservationOwnership;
    return yield* ownership.activeAccountId;
  }).pipe(Effect.provide(provideOwnership(options)));

test("rechecks authoritative account activity after resolving the account", async () => {
  await expect(Effect.runPromise(run({}))).resolves.toEqual(testLinkedAccount);
});

test.each(testResolvedStandingLabels)(
  "resolves the customer for %s as the resolver did",
  async (label) => {
    const standing = testResolvedStandings[label];
    const outcome = run({ standing }).pipe(Effect.result, Effect.runPromise);

    if (standing.kind === "linked") {
      expect(await outcome).toMatchObject({
        _tag: "Success",
        success: testLinkedAccount,
      });
    } else {
      expect(await outcome).toMatchObject({
        _tag: "Failure",
        failure: linkedAccountFailure(standing),
      });
    }
  }
);

test.each([
  ["missing account", { kind: "missing" } as const, "unauthenticated"],
  [
    "account pending deletion",
    {
      kind: "active",
      email: testEmailAddress("owner"),
      deletionRequestedAt: new Date("2026-09-01T10:00:00.000Z"),
    } as const,
    "link-required",
  ],
] as const)("fails closed for %s", async (_label, activity, reason) => {
  await expect(Effect.runPromise(run({ activity }))).rejects.toMatchObject({
    _tag: "CustomerAccountAccessError",
    reason,
  });
});

test("identifies the active signed-in account without a linked customer", async () => {
  await expect(
    Effect.runPromise(
      runActiveAccountId({ standing: testResolvedStandings["profile missing"] })
    )
  ).resolves.toBe(testCustomerSession.accountId);
});

test.each([
  [
    "signed-out session",
    { active: new CustomerAccountAccessError({ reason: "unauthenticated" }) },
    "unauthenticated",
  ],
  [
    "session pending deletion",
    {
      active: new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "deletion-requested",
      }),
    },
    "link-required",
  ],
  [
    "missing account",
    { activity: { kind: "missing" } as const },
    "unauthenticated",
  ],
  [
    "account pending deletion",
    {
      activity: {
        kind: "active",
        email: testEmailAddress("owner"),
        deletionRequestedAt: new Date("2026-09-01T10:00:00.000Z"),
      } as const,
    },
    "link-required",
  ],
] as const)(
  "fails the active account closed for %s",
  async (_label, options, reason) => {
    await expect(
      Effect.runPromise(runActiveAccountId(options))
    ).rejects.toMatchObject({ _tag: "CustomerAccountAccessError", reason });
  }
);
