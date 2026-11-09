import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import {
  type CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import { readCurrentAccountCustomerLink } from "./account-customer-link";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";

const accountId = customerAccountIdSchema.make("auth-user-1");
const customerId = DotyposCustomerIdSchema.make("dotypos-customer-1");

const session = (
  overrides: Partial<CustomerAccountSession> = {}
): CustomerAccountSession => ({
  accountId,
  email: testEmailAddress("ada"),
  deletionRequested: false,
  ...overrides,
});

const unused = () => Effect.die("unused in this read");

const readLink = (input: {
  readonly session: CustomerAccountSession | null;
  readonly find?: () => Effect.Effect<
    typeof customerId | null,
    SqlError.SqlError
  >;
}) => {
  const findCalls: string[] = [];
  const run = readCurrentAccountCustomerLink.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(CustomerAuthentication, {
          currentUser: Effect.succeed(input.session),
        }),
        Layer.succeed(CustomerAccountLinkRepository, {
          find: (id) => {
            findCalls.push(id);
            return input.find?.() ?? Effect.succeed(null);
          },
          claim: unused,
          findActivityState: unused,
          markDeletionRequested: unused,
          withAccountLock: unused,
        })
      )
    ),
    Effect.result,
    Effect.runPromise
  );
  return { findCalls, run };
};

describe("readCurrentAccountCustomerLink", () => {
  test("returns only the linked account's Dotypos customer ID", async () => {
    const { findCalls, run } = readLink({
      session: session(),
      find: () => Effect.succeed(customerId),
    });

    const outcome = await run;

    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") {
      expect(outcome.success).toEqual({
        accountId,
        dotyposCustomerId: customerId,
      });
      expect(JSON.stringify(outcome.success)).not.toContain("@");
    }
    expect(findCalls).toEqual([accountId]);
  });

  test("reports no customer for an account without a link", async () => {
    const outcome = await readLink({ session: session() }).run;

    expect(outcome).toMatchObject({
      _tag: "Success",
      success: { accountId, dotyposCustomerId: null },
    });
  });

  test("reports no account without a verified session", async () => {
    const { findCalls, run } = readLink({ session: null });

    expect(await run).toMatchObject({
      _tag: "Success",
      success: { accountId: null, dotyposCustomerId: null },
    });
    expect(findCalls).toEqual([]);
  });

  test("reports no customer for an account awaiting deletion", async () => {
    const { findCalls, run } = readLink({
      session: session({ deletionRequested: true }),
      find: () => Effect.succeed(customerId),
    });

    expect(await run).toMatchObject({
      _tag: "Success",
      success: { accountId, dotyposCustomerId: null },
    });
    expect(findCalls).toEqual([]);
  });

  test("classifies a failed link read without leaking its cause", async () => {
    const outcome = await readLink({
      session: session(),
      find: () =>
        Effect.fail(
          new SqlError.SqlError({
            reason: new SqlError.UnknownError({
              cause: new Error("synthetic connection refused"),
              message: "synthetic connection refused",
              operation: "connect",
            }),
          })
        ),
    }).run;

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const error = outcome.failure as CustomerAccountAccessError;
      expect(error.reason).toBe("unavailable");
      expect(error.cause?.code).toBe("account-link.read");
      expect(JSON.stringify(error)).not.toContain("synthetic");
    }
  });
});
