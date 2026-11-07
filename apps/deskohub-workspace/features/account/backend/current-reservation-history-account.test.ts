import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { customerAccountUnavailable } from "../customer-account";
import {
  testCustomerSession,
  testLinkedAccount,
} from "./account-operations.test-utils";
import { currentReservationHistoryAccount } from "./current-reservation-history-account";
import { CustomerAccountContactService } from "./customer-account-contact.service";

const readWith = (
  currentLinkedAccount: CustomerAccountContactService["Service"]["currentLinkedAccount"]
) =>
  currentReservationHistoryAccount(testCustomerSession.accountId).pipe(
    Effect.provide(
      Layer.mock(CustomerAccountContactService, { currentLinkedAccount })
    ),
    Effect.result,
    Effect.runPromise
  );

describe("currentReservationHistoryAccount", () => {
  test("includes the linked account's own customer's reservations", async () => {
    const result = await readWith(
      Effect.succeed({
        ...testLinkedAccount,
        email: testCustomerSession.email,
      })
    );

    expect(result._tag === "Success" && result.success).toEqual(
      testLinkedAccount
    );
  });

  test("covers only the reservations an unlinked account authored", async () => {
    const result = await readWith(Effect.succeed(null));

    expect(result._tag === "Success" && result.success).toEqual({
      accountId: testCustomerSession.accountId,
    });
  });

  test("fails when the account's link can't be read", async () => {
    const failure = customerAccountUnavailable("account-link.read");

    const result = await readWith(Effect.fail(failure));

    expect(result._tag === "Failure" && result.failure).toBe(failure);
  });
});
