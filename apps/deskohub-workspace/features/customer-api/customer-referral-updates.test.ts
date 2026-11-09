import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { CustomerAccountContactService } from "@/features/account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { CustomerReferralUpdates } from "./customer-referral-updates";

const booker = dotyposCustomerIdSchema.make("60111");
const sentCode = "RFL12345";
const acceptedCode = canonicalPromotionCodeSchema.make("RFLTYPED1");

/**
 * Runs `use` against the request's recording RememberedReferral, for a
 * client that sent `code`, and answers what the request recorded.
 */
const run = <A>(
  use: (remembered: RememberedReferral["Service"]) => Effect.Effect<A>,
  options: {
    readonly code?: string;
    readonly released?: boolean;
    readonly settled?: boolean;
  } = {}
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const referral = yield* CustomerReferralUpdates;
      const value = yield* Effect.flatMap(RememberedReferral, use).pipe(
        Effect.provide(referral.remembered)
      );
      return { value, updates: yield* referral.recorded };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          CustomerReferralUpdates.fromClient(options.code),
          ReferralReleaseGate.fromDecision(options.released ?? true),
          ReferralServiceMock({
            hasSettledReferral: () => Effect.succeed(options.settled ?? false),
          }),
          Layer.mock(CustomerAccountContactService, {
            currentAccount: Effect.succeed({
              status: "linked",
              accountId: customerAccountIdSchema.make("account-1"),
              dotyposCustomerId: booker,
              email: reservationCustomerEmailSchema.make(
                testEmailAddress("booker")
              ),
            }),
          })
        )
      )
    )
  );

describe("CustomerReferralUpdates.fromClient", () => {
  test("reads the code the client sent", async () => {
    const { value, updates } = await run((remembered) => remembered.code, {
      code: sentCode,
    });

    expect(value).toBe(sentCode);
    expect(updates).toEqual({});
  });

  test("reports an accepted code for the client to remember", async () => {
    const { updates } = await run(
      (remembered) => remembered.remember(acceptedCode).pipe(Effect.orDie),
      {}
    );

    expect(updates).toEqual({ rememberReferralCode: "RFLTYPED1" });
  });

  test("reports nothing to remember while referrals are withheld", async () => {
    const { updates } = await run(
      (remembered) => remembered.remember(acceptedCode).pipe(Effect.orDie),
      { released: false }
    );

    expect(updates).toEqual({});
  });

  test("reports the sent code used once the booker's referral settles", async () => {
    const { updates } = await run(
      (remembered) => remembered.forgetIfSettled({ kind: "order", paid: true }),
      { code: sentCode, settled: true }
    );

    expect(updates).toEqual({ rememberedReferralCodeUsed: true });
  });

  test("keeps the sent code while the booker's referral is unsettled", async () => {
    const { updates } = await run(
      (remembered) => remembered.forgetIfSettled({ kind: "order", paid: true }),
      { code: sentCode, settled: false }
    );

    expect(updates).toEqual({});
  });

  test("reports nothing used when the client sent no code", async () => {
    const { updates } = await run(
      (remembered) => remembered.forgetIfSettled({ kind: "order", paid: true }),
      { settled: true }
    );

    expect(updates).toEqual({});
  });
});
