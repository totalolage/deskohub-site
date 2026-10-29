import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit, Layer } from "effect";
import { redirect } from "next/navigation";
import { CustomerAccountContactService } from "@/features/account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { parseReferralCode } from "./client";
import { ReferralError } from "./contracts";
import type { IReferralService } from "./referral.service";
import { ReferralServiceMock } from "./referral.service.mock";
import { ReferralFeatureFlagService } from "./referral-feature-flag.service";
import { RememberedReferral } from "./remembered-referral.service";

type CurrentAccount = Effect.Success<
  CustomerAccountContactService["Service"]["currentAccount"]
>;

const booker = dotyposCustomerIdSchema.make("60111");
const friend = dotyposCustomerIdSchema.make("60222");
const sharedCode = "RFL12345";
const sharedReferralCode = (() => {
  const code = parseReferralCode(sharedCode);
  if (code === undefined) throw new Error("Invalid test referral code");
  return code;
})();
const typedCode = canonicalPromotionCodeSchema.make("RFLTYPED1");
const accountId = customerAccountIdSchema.make("account-1");
const email = reservationCustomerEmailSchema.make(testEmailAddress("booker"));

const linkedAs = (dotyposCustomerId: DotyposCustomerId): CurrentAccount => ({
  status: "linked",
  accountId,
  dotyposCustomerId,
  email,
});

/**
 * Runs `use` against the in-memory adapter: a browser sending `cookie`, the
 * referral release decision, the session's account, and the customers whose
 * referral is settled.
 */
const run = async <A, E>(
  use: (remembered: RememberedReferral["Service"]) => Effect.Effect<A, E>,
  options: {
    readonly cookie?: string;
    readonly released?: boolean;
    readonly writable?: boolean;
    readonly account?: CurrentAccount;
    readonly settled?: readonly DotyposCustomerId[];
    readonly referrals?: Partial<IReferralService>;
  } = {}
) => {
  const cookie = { value: options.cookie };
  const settledChecks: DotyposCustomerId[] = [];
  const sessionReads = { count: 0 };
  const exit = await Effect.runPromiseExit(
    Effect.flatMap(RememberedReferral, use).pipe(
      Effect.provide(
        RememberedReferral.inMemory(cookie, {
          writable: options.writable ?? true,
        }).pipe(
          Layer.provide(
            Layer.mergeAll(
              ReferralFeatureFlagService.fromDecision(options.released ?? true),
              ReferralServiceMock({
                hasSettledReferral: ({ dotyposCustomerId }) =>
                  Effect.sync(() => {
                    settledChecks.push(dotyposCustomerId);
                    return (options.settled ?? []).includes(dotyposCustomerId);
                  }),
                ...options.referrals,
              }),
              Layer.mock(CustomerAccountContactService, {
                currentAccount: Effect.sync(() => {
                  sessionReads.count += 1;
                  return options.account ?? { status: "signed-out" };
                }),
              })
            )
          )
        )
      )
    )
  );
  return { exit, cookie: cookie.value, settledChecks, sessionReads };
};

const value = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isFailure(exit)) throw new Error("Expected success");
  return exit.value;
};

describe("RememberedReferral.code", () => {
  test("reads the remembered shared code while referrals are released", async () => {
    const result = await run((remembered) => remembered.code, {
      cookie: "rfl12345",
    });
    expect(value(result.exit)).toBe(sharedCode);
  });

  test("ignores the remembered code while referrals are withheld", async () => {
    const result = await run((remembered) => remembered.code, {
      cookie: sharedCode,
      released: false,
    });
    expect(value(result.exit)).toBeUndefined();
  });

  test("ignores a value that isn't shaped like a referral code", async () => {
    const result = await run((remembered) => remembered.code, {
      cookie: "not a code",
    });
    expect(value(result.exit)).toBeUndefined();
  });
});

describe("RememberedReferral.forBooking", () => {
  test("carries an eligible code into the account's own booking", async () => {
    const evaluateCheckoutReferral = mock(() =>
      Effect.succeed({
        kind: "eligible" as const,
        code: sharedReferralCode,
      })
    );
    const result = await run(
      (remembered) =>
        remembered.forBooking({ for: "account", customerId: booker }),
      { cookie: sharedCode, referrals: { evaluateCheckoutReferral } }
    );
    expect(value(result.exit)).toEqual({
      kind: "carried",
      referralCode: sharedCode,
    });
    expect(evaluateCheckoutReferral).toHaveBeenCalledWith({
      code: sharedCode,
      dotyposCustomerId: booker,
    });
  });

  test("applies an already accepted referral without carrying the code", async () => {
    const result = await run(
      (remembered) =>
        remembered.forBooking({ for: "account", customerId: booker }),
      {
        cookie: sharedCode,
        referrals: {
          evaluateCheckoutReferral: () =>
            Effect.succeed({ kind: "already_accepted" as const }),
        },
      }
    );
    expect(value(result.exit)).toEqual({ kind: "carried" });
  });

  test("takes nothing when the account can't take the referral", async () => {
    const result = await run(
      (remembered) =>
        remembered.forBooking({ for: "account", customerId: booker }),
      {
        cookie: sharedCode,
        referrals: {
          evaluateCheckoutReferral: () =>
            Effect.fail(new ReferralError({ reason: "ineligible" })),
        },
      }
    );
    expect(value(result.exit)).toEqual({ kind: "none" });
  });

  test("prefills a usable code for a booking made for someone else", async () => {
    const findAvailableCode = mock(() => Effect.succeed(sharedReferralCode));
    const result = await run(
      (remembered) => remembered.forBooking({ for: "someone-else" }),
      { cookie: sharedCode, referrals: { findAvailableCode } }
    );
    expect(value(result.exit)).toEqual({ kind: "prefill", code: sharedCode });
  });

  test("drops an unusable code for a booking made for someone else", async () => {
    const result = await run(
      (remembered) => remembered.forBooking({ for: "someone-else" }),
      {
        cookie: sharedCode,
        referrals: { findAvailableCode: () => Effect.undefined },
      }
    );
    expect(value(result.exit)).toEqual({ kind: "none" });
  });

  test("checks nothing without a code or while referrals are withheld", async () => {
    const evaluateCheckoutReferral = mock(() => Effect.die("unexpected"));
    const findAvailableCode = mock(() => Effect.die("unexpected"));
    for (const options of [
      {},
      { cookie: sharedCode, released: false },
    ] as const) {
      for (const booking of [
        { for: "account", customerId: booker },
        { for: "someone-else" },
      ] as const) {
        const result = await run(
          (remembered) => remembered.forBooking(booking),
          {
            ...options,
            referrals: { evaluateCheckoutReferral, findAvailableCode },
          }
        );
        expect(value(result.exit)).toEqual({ kind: "none" });
      }
    }
    expect(evaluateCheckoutReferral).not.toHaveBeenCalled();
    expect(findAvailableCode).not.toHaveBeenCalled();
  });

  test("takes nothing when a referral read dies", async () => {
    const result = await run(
      (remembered) => remembered.forBooking({ for: "someone-else" }),
      {
        cookie: sharedCode,
        referrals: { findAvailableCode: () => Effect.die("database down") },
      }
    );
    expect(value(result.exit)).toEqual({ kind: "none" });
  });
});

describe("RememberedReferral.remember", () => {
  test("replaces the remembered code with an accepted typed code", async () => {
    const result = await run((remembered) => remembered.remember(typedCode), {
      cookie: sharedCode,
    });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.cookie).toBe(typedCode);
  });

  test("writes nothing while referrals are withheld", async () => {
    const result = await run((remembered) => remembered.remember(typedCode), {
      cookie: sharedCode,
      released: false,
    });
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.cookie).toBe(sharedCode);
  });

  test("fails where cookies can't be written", async () => {
    const result = await run((remembered) => remembered.remember(typedCode), {
      writable: false,
    });
    expect(Exit.isFailure(result.exit)).toBe(true);
    expect(result.cookie).toBeUndefined();
  });
});

describe("RememberedReferral.forgetIfSettled", () => {
  test("forgets the code once a linked account's referral is settled", async () => {
    const result = await run(
      (remembered) =>
        remembered.forgetIfSettled({ kind: "account", customerId: booker }),
      { cookie: sharedCode, settled: [booker] }
    );
    expect(Exit.isSuccess(result.exit)).toBe(true);
    expect(result.cookie).toBeUndefined();
    expect(result.settledChecks).toEqual([booker]);
    expect(result.sessionReads.count).toBe(0);
  });

  test("keeps the code while a linked account's referral is open", async () => {
    const result = await run(
      (remembered) =>
        remembered.forgetIfSettled({ kind: "account", customerId: booker }),
      { cookie: sharedCode }
    );
    expect(result.cookie).toBe(sharedCode);
  });

  test("checks nothing without a code or while referrals are withheld", async () => {
    for (const options of [
      {},
      { cookie: sharedCode, released: false },
    ] as const) {
      const result = await run(
        (remembered) =>
          remembered.forgetIfSettled({ kind: "order", paid: true }),
        { ...options, account: linkedAs(booker), settled: [booker] }
      );
      expect(result.cookie).toBe(options.cookie);
      expect(result.settledChecks).toEqual([]);
      expect(result.sessionReads.count).toBe(0);
    }
  });

  test("settles an order by the signed-in booker, never the booked friend", async () => {
    const keeps = await run(
      (remembered) =>
        remembered.forgetIfSettled({
          kind: "order",
          paid: true,
          bookedCustomerId: friend,
        }),
      { cookie: sharedCode, account: linkedAs(booker), settled: [friend] }
    );
    expect(keeps.cookie).toBe(sharedCode);
    expect(keeps.settledChecks).toEqual([booker]);

    const forgets = await run(
      (remembered) =>
        remembered.forgetIfSettled({
          kind: "order",
          paid: false,
          bookedCustomerId: friend,
        }),
      { cookie: sharedCode, account: linkedAs(booker), settled: [booker] }
    );
    expect(forgets.cookie).toBeUndefined();
  });

  test("keeps the code of an account without a profile", async () => {
    const result = await run(
      (remembered) => remembered.forgetIfSettled({ kind: "order", paid: true }),
      {
        cookie: sharedCode,
        account: { status: "unlinked", accountId, email },
      }
    );
    expect(result.cookie).toBe(sharedCode);
    expect(result.settledChecks).toEqual([]);
  });

  test("lets the booked customer stand in once the session is signed out", async () => {
    const paid = await run(
      (remembered) => remembered.forgetIfSettled({ kind: "order", paid: true }),
      { cookie: sharedCode }
    );
    expect(paid.cookie).toBeUndefined();
    expect(paid.settledChecks).toEqual([]);

    const unpaid = await run(
      (remembered) =>
        remembered.forgetIfSettled({
          kind: "order",
          paid: false,
          bookedCustomerId: booker,
        }),
      { cookie: sharedCode, settled: [booker] }
    );
    expect(unpaid.cookie).toBeUndefined();
    expect(unpaid.settledChecks).toEqual([booker]);

    const unknown = await run(
      (remembered) =>
        remembered.forgetIfSettled({ kind: "order", paid: false }),
      { cookie: sharedCode }
    );
    expect(unknown.cookie).toBe(sharedCode);
  });

  test("keeps the code and never fails when the check or the write fails", async () => {
    const failedCheck = await run(
      (remembered) =>
        remembered.forgetIfSettled({ kind: "account", customerId: booker }),
      {
        cookie: sharedCode,
        referrals: {
          hasSettledReferral: () =>
            Effect.fail(new ReferralError({ reason: "unavailable" })),
        },
      }
    );
    expect(Exit.isSuccess(failedCheck.exit)).toBe(true);
    expect(failedCheck.cookie).toBe(sharedCode);

    const failedWrite = await run(
      (remembered) =>
        remembered.forgetIfSettled({ kind: "account", customerId: booker }),
      { cookie: sharedCode, settled: [booker], writable: false }
    );
    expect(Exit.isSuccess(failedWrite.exit)).toBe(true);
    expect(failedWrite.cookie).toBe(sharedCode);
  });

  test("lets Next.js control flow through", async () => {
    const control = (() => {
      try {
        redirect("/en-US");
      } catch (error) {
        return error;
      }
    })();
    const result = await run(
      (remembered) =>
        remembered.forgetIfSettled({ kind: "account", customerId: booker }),
      {
        cookie: sharedCode,
        referrals: { hasSettledReferral: () => Effect.die(control) },
      }
    );
    expect(Exit.isFailure(result.exit)).toBe(true);
    expect(result.cookie).toBe(sharedCode);
  });
});

describe("RememberedReferral.isSettled", () => {
  // A Server Component render or prerender can't write cookies; the page
  // renders the browser forgetter from this answer instead.
  test("answers for a Server Component without writing", async () => {
    const result = await run(
      (remembered) => remembered.isSettled({ kind: "order", paid: true }),
      { cookie: sharedCode, writable: false }
    );
    expect(value(result.exit)).toBe(true);
    expect(result.cookie).toBe(sharedCode);
  });

  test("is false without a code, while withheld, or when the check fails", async () => {
    const withoutCode = await run((remembered) =>
      remembered.isSettled({ kind: "account", customerId: booker })
    );
    expect(value(withoutCode.exit)).toBe(false);

    const withheld = await run(
      (remembered) =>
        remembered.isSettled({ kind: "account", customerId: booker }),
      { cookie: sharedCode, released: false, settled: [booker] }
    );
    expect(value(withheld.exit)).toBe(false);
    expect(withheld.settledChecks).toEqual([]);

    const failed = await run(
      (remembered) =>
        remembered.isSettled({ kind: "account", customerId: booker }),
      {
        cookie: sharedCode,
        referrals: { hasSettledReferral: () => Effect.die("database down") },
      }
    );
    expect(value(failed.exit)).toBe(false);
  });
});

describe("RememberedReferral.none", () => {
  test("remembers, carries, and forgets nothing for a channel without a browser", async () => {
    const remembered = await Effect.runPromise(
      RememberedReferral.pipe(Effect.provide(RememberedReferral.none))
    );
    expect(await Effect.runPromise(remembered.code)).toBeUndefined();
    expect(
      await Effect.runPromise(
        remembered.forBooking({ for: "account", customerId: booker })
      )
    ).toEqual({ kind: "none" });
    expect(
      await Effect.runPromise(
        remembered.isSettled({ kind: "order", paid: true })
      )
    ).toBe(false);
  });
});
