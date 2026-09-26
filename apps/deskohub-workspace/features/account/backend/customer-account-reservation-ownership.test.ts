import { expect, test } from "bun:test";
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

const account = {
  accountId: customerAccountIdSchema.make("account-1"),
  dotyposCustomerId: "customer-1",
} as const;

const run = (options: {
  readonly resolve?: typeof account | CustomerAccountAccessError;
  readonly activity?: CustomerAccountActivityState;
}) => {
  const resolver =
    options.resolve instanceof CustomerAccountAccessError
      ? Layer.succeed(CustomerAccountResolver, {
          resolve: Effect.fail(options.resolve),
        })
      : Layer.succeed(CustomerAccountResolver, {
          resolve: Effect.succeed(options.resolve ?? account),
        });
  const activity = options.activity ?? {
    kind: "active",
    deletionRequestedAt: null,
  };

  return Effect.gen(function* () {
    const ownership = yield* CustomerAccountReservationOwnership;
    return yield* ownership.resolve;
  }).pipe(
    Effect.provide(CustomerAccountReservationOwnership.Default),
    Effect.provide(
      Layer.mergeAll(
        resolver,
        Layer.mock(CustomerAccountLinkRepository, {
          findActivityState: () => Effect.succeed(activity),
        })
      )
    )
  );
};

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

test("fails closed when account resolution is unavailable", async () => {
  await expect(
    Effect.runPromise(
      run({
        resolve: new CustomerAccountAccessError({ reason: "unavailable" }),
      })
    )
  ).rejects.toMatchObject({
    _tag: "CustomerAccountAccessError",
    reason: "unavailable",
  });
});
