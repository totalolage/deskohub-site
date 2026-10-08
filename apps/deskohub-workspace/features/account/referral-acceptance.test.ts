import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import { ReferralError } from "@/features/referrals/contracts";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { customerAccountIdSchema } from "./customer-account";
import {
  type AccountReferralAcceptanceResult,
  acceptReferralForAccount,
} from "./referral-acceptance";

const account = {
  accountId: Schema.decodeUnknownSync(customerAccountIdSchema)("account-123"),
  dotyposCustomerId: Schema.decodeUnknownSync(dotyposCustomerIdSchema)(
    "customer-123"
  ),
};

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);

describe("acceptReferralForAccount", () => {
  test("rejects malformed referral codes without calling the service", async () => {
    const accept = mock(() => Effect.die("must not call service"));

    await expect(
      run(acceptReferralForAccount("lowercase", account, accept))
    ).resolves.toEqual({
      status: "unavailable",
    } satisfies AccountReferralAcceptanceResult);
    expect(accept).not.toHaveBeenCalled();
  });

  test("passes the strict code and linked identity from the resolver", async () => {
    const accept = mock((input) => {
      expect(input).toEqual({
        code: "RFL12345",
        customerAccountId: account.accountId,
        dotyposCustomerId: account.dotyposCustomerId,
      });
      return Effect.succeed({ kind: "accepted" as const });
    });

    await expect(
      run(acceptReferralForAccount("RFL12345", account, accept))
    ).resolves.toEqual({
      status: "accepted",
    });
    expect(accept).toHaveBeenCalledTimes(1);
  });

  test("reports an existing identical attribution without duplicating it", async () => {
    const accept = mock(() =>
      Effect.succeed({ kind: "already_accepted" as const })
    );

    await expect(
      run(acceptReferralForAccount("RFL12345", account, accept))
    ).resolves.toEqual({
      status: "already_accepted",
    });
  });

  test.each([
    ["self_referral", "self_referral"],
    ["already_attributed", "already_attributed"],
    ["ineligible", "ineligible"],
    ["invalid_code", "unavailable"],
    ["unavailable", "unavailable"],
    ["account_unavailable", "unavailable"],
  ] as const)(
    "maps %s into its public invitation state",
    async (reason, status) => {
      const accept = mock(() => Effect.fail(new ReferralError({ reason })));

      await expect(
        run(acceptReferralForAccount("RFL12345", account, accept))
      ).resolves.toEqual({
        status,
      });
    }
  );
});
