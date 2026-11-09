import { expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import {
  type CustomerAccountActivityState,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import { CustomerAccountReservationOwnership } from "./customer-account-reservation-ownership";
import { CustomerAccountResolver } from "./customer-account-resolver.service";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";

const account = {
  accountId: customerAccountIdSchema.make("account-1"),
  dotyposCustomerId: "customer-1",
} as const;

const session: CustomerAccountSession = {
  accountId: account.accountId,
  email: testEmailAddress("account-1"),
  deletionRequested: false,
};

const provideOwnership = (options: {
  readonly resolve?: typeof account | CustomerAccountAccessError;
  readonly activity?: CustomerAccountActivityState;
  readonly session?: CustomerAccountSession | null;
}) => {
  const resolver =
    options.resolve instanceof CustomerAccountAccessError
      ? Layer.mock(CustomerAccountResolver, {
          resolve: Effect.fail(options.resolve),
        })
      : Layer.mock(CustomerAccountResolver, {
          resolve: Effect.succeed(options.resolve ?? account),
        });
  const activity = options.activity ?? {
    kind: "active",
    deletionRequestedAt: null,
  };

  return CustomerAccountReservationOwnership.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        resolver,
        Layer.succeed(CustomerAuthentication, {
          currentUser: Effect.succeed(
            options.session === undefined ? session : options.session
          ),
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
  await expect(Effect.runPromise(run({}))).resolves.toEqual(account);
});

test.each([
  ["missing account", { kind: "missing" } as const, "unauthenticated"],
  [
    "account pending deletion",
    {
      kind: "active",
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
      runActiveAccountId({
        resolve: new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "not-found",
        }),
      })
    )
  ).resolves.toBe(account.accountId);
});

test.each([
  ["signed-out session", { session: null }, "unauthenticated"],
  [
    "session pending deletion",
    { session: { ...session, deletionRequested: true } },
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
