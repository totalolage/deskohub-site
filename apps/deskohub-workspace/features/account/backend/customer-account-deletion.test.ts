import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { customerAccountIdSchema } from "../customer-account";
import { deleteCustomerIdentity } from "./customer-account-deletion";

const accountId = Schema.decodeUnknownSync(customerAccountIdSchema)(
  "account-1"
);

describe("customer account deletion", () => {
  test("unlinks the local customer mapping before deleting the auth user", async () => {
    const operations: string[] = [];

    await Effect.runPromise(
      deleteCustomerIdentity(
        accountId,
        () =>
          Effect.sync(() => {
            operations.push("unlink");
          }),
        Effect.sync(() => {
          operations.push("delete-user");
        })
      )
    );

    expect(operations).toEqual(["unlink", "delete-user"]);
  });

  test("does not delete the auth user when unlinking fails", async () => {
    let deleted = false;
    const result = await Effect.runPromiseExit(
      deleteCustomerIdentity(
        accountId,
        () => Effect.fail("database unavailable"),
        Effect.sync(() => {
          deleted = true;
        })
      )
    );

    expect(result._tag).toBe("Failure");
    expect(deleted).toBe(false);
  });
});
