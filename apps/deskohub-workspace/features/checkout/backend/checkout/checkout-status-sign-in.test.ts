import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  type PeekedStanding,
  peeking,
  type TestPeekedStandingLabel,
  testPeekedStandingLabels,
  testPeekedStandings,
} from "@/features/account/backend/current-customer-account.test-utils";
import {
  type CustomerAccountAccessError,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  getReservationStatusSignInPath,
  isStatusViewerSignedOut,
} from "./checkout-status-sign-in";

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
  const run = (standing: PeekedStanding | CustomerAccountAccessError) =>
    isStatusViewerSignedOut().pipe(
      Effect.provide(peeking(standing)),
      Effect.runPromise
    );

  // The status page's policy, one row per standing `peek` reports.
  const signedOut = {
    "signed out": true,
    // An unverified session isn't signed out.
    unverified: false,
    "awaiting deletion": true,
    "awaiting deletion, review marker present": true,
    "awaiting deletion, review marker unreadable": true,
    "review account": false,
    unlinked: false,
    "unlinked, review marker unreadable": false,
    linked: false,
    "linked, review marker unreadable": false,
    // An unreadable link isn't signed out.
    "link unavailable": false,
  } satisfies Record<TestPeekedStandingLabel, boolean>;

  test.each(testPeekedStandingLabels)(
    "answers the standing %s with its own sign-in policy",
    async (label) => {
      expect(await run(testPeekedStandings[label])).toBe(signedOut[label]);
    }
  );

  test("doesn't read an unreadable session as signed out", async () => {
    expect(
      await run(customerAccountUnavailable("authentication.session"))
    ).toBe(false);
  });
});
