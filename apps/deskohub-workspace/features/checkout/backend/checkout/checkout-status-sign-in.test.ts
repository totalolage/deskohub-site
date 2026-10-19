import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import {
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  getReservationStatusSignInPath,
  isStatusViewerSignedOut,
} from "./checkout-status-sign-in";

type CurrentCustomerAccount = Effect.Success<
  CustomerAccountContactService["Service"]["currentAccount"]
>;

const orderId = workspaceReservationIdSchema.make("reservation-1");

const signInUrl = (outcome?: "success" | "cancelled") =>
  new URL(
    getReservationStatusSignInPath("cs-CZ", orderId, outcome),
    "https://site.invalid"
  );

describe("getReservationStatusSignInPath", () => {
  test("returns to the reservation status page after a reservation sign-in", () => {
    const url = signInUrl();

    expect(url.pathname).toBe("/cs-CZ/auth/sign-in");
    expect(url.searchParams.get("returnTo")).toBe(
      "/cs-CZ/reservation/status/reservation-1"
    );
    expect(url.searchParams.get("for")).toBe("reservation");
  });

  test.each(["success", "cancelled"] as const)(
    "keeps the %s payment outcome on the return path",
    (outcome) => {
      expect(signInUrl(outcome).searchParams.get("returnTo")).toBe(
        `/cs-CZ/reservation/status/reservation-1?outcome=${outcome}`
      );
    }
  );
});

describe("isStatusViewerSignedOut", () => {
  const accountId = customerAccountIdSchema.make("auth-user-1");
  const email = reservationCustomerEmailSchema.make(testEmailAddress("ada"));

  const run = (
    currentAccount: CustomerAccountContactService["Service"]["currentAccount"]
  ) =>
    isStatusViewerSignedOut().pipe(
      Effect.provide(
        Layer.mock(CustomerAccountContactService, { currentAccount })
      ),
      Effect.runPromise
    );

  test("reads a signed-out session as signed out", async () => {
    expect(await run(Effect.succeed({ status: "signed-out" }))).toBe(true);
  });

  test.each([
    ["an unlinked", { status: "unlinked", accountId, email }],
    [
      "a linked",
      { status: "linked", accountId, dotyposCustomerId: "60111", email },
    ],
  ] as const)("reads %s session as signed in", async (_label, account) => {
    expect(await run(Effect.succeed(account as CurrentCustomerAccount))).toBe(
      false
    );
  });

  test("doesn't read an unreadable session as signed out", async () => {
    expect(
      await run(Effect.fail(customerAccountUnavailable("account-link.read")))
    ).toBe(false);
  });
});
