import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { customerAccountIdSchema } from "../customer-account";
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
    const result = await Effect.runPromiseExit(
      deleteCustomerIdentity(
        accountId,
        withAccountLock,
        () => Effect.fail("database unavailable"),
        Effect.sync(() => {
          deleted = true;
        })
      )
    );

    expect(result._tag).toBe("Failure");
    expect(deleted).toBe(false);
  });

  test("removes a link recreated while Neon deletes the identity", async () => {
    let linked = true;

    await Effect.runPromise(
      deleteCustomerIdentity(
        accountId,
        withAccountLock,
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
