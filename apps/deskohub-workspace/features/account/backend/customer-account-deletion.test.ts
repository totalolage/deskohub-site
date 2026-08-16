import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import { deleteCustomerIdentity } from "./customer-account-deletion";

const accountId = Schema.decodeUnknownSync(customerAccountIdSchema)(
  "account-1"
);
const withAccountLock = <A, E, R>(
  _accountId: typeof accountId,
  effect: Effect.Effect<A, E, R>
) => effect;

describe("customer account deletion", () => {
  test("unlinks the local customer mapping before deleting the auth user", async () => {
    const operations: string[] = [];

    await Effect.runPromise(
      deleteCustomerIdentity(
        accountId,
        withAccountLock,
        Effect.succeed(accountId),
        () =>
          Effect.sync(() => {
            operations.push("unlink");
          }),
        Effect.sync(() => {
          operations.push("delete-user");
        })
      )
    );

    expect(operations).toEqual(["unlink", "delete-user", "unlink"]);
  });

  test("does not delete the auth user when unlinking fails", async () => {
    let deleted = false;
    const error = await Effect.runPromise(
      Effect.flip(
        deleteCustomerIdentity(
          accountId,
          withAccountLock,
          Effect.succeed(accountId),
          () => Effect.fail(new Error("sensitive-database-payload")),
          Effect.sync(() => {
            deleted = true;
          })
        )
      )
    );

    expect(error).toMatchObject({
      reason: "unavailable",
      cause: { code: "account-link.unlink" },
    });
    expect(JSON.stringify(error)).not.toContain("sensitive-database-payload");
    expect(deleted).toBe(false);
  });

  test("distinguishes lock and auth deletion failures", async () => {
    const lockError = await Effect.runPromise(
      Effect.flip(
        deleteCustomerIdentity(
          accountId,
          () => Effect.fail(new Error("sensitive-lock-payload")),
          Effect.succeed(accountId),
          () => Effect.void,
          Effect.void
        )
      )
    );
    const authError = await Effect.runPromise(
      Effect.flip(
        deleteCustomerIdentity(
          accountId,
          withAccountLock,
          Effect.succeed(accountId),
          () => Effect.void,
          Effect.fail(new Error("sensitive-auth-payload"))
        )
      )
    );

    expect(lockError).toMatchObject({
      reason: "unavailable",
      cause: { code: "account-link.lock" },
    });
    expect(authError).toMatchObject({
      reason: "unavailable",
      cause: { code: "authentication.account-delete" },
    });
    expect(lockError).toBeInstanceOf(CustomerAccountAccessError);
    expect(authError).toBeInstanceOf(CustomerAccountAccessError);
    expect(JSON.stringify([lockError, authError])).not.toContain("sensitive-");
  });

  test("does not delete after the session changes while waiting for the lock", async () => {
    let deleted = false;
    let sessionStillCurrent = true;
    let unlinked = false;
    const delayedLock = <A, E, R>(
      _accountId: typeof accountId,
      effect: Effect.Effect<A, E, R>
    ) =>
      Effect.sync(() => {
        sessionStillCurrent = false;
      }).pipe(Effect.andThen(effect));

    const result = await Effect.runPromiseExit(
      deleteCustomerIdentity(
        accountId,
        delayedLock,
        Effect.sync(() => (sessionStillCurrent ? accountId : null)),
        () =>
          Effect.sync(() => {
            unlinked = true;
          }),
        Effect.sync(() => {
          deleted = true;
        })
      )
    );

    expect(sessionStillCurrent).toBe(false);
    expect(result._tag).toBe("Failure");
    expect(unlinked).toBe(false);
    expect(deleted).toBe(false);
  });

  test("removes a link recreated while Neon deletes the identity", async () => {
    let linked = true;

    await Effect.runPromise(
      deleteCustomerIdentity(
        accountId,
        withAccountLock,
        Effect.succeed(accountId),
        () =>
          Effect.sync(() => {
            linked = false;
          }),
        Effect.sync(() => {
          linked = true;
        })
      )
    );

    expect(linked).toBe(false);
  });
});
