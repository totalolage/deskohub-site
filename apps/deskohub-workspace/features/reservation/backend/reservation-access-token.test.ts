import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessTokenSchema } from "@/features/reservation/reservation-access-token";
import {
  createReservationAccessToken,
  openReservationAccessToken,
} from "./reservation-access-token";

const secret = Buffer.alloc(32, 9);
const orderId = workspaceReservationIdSchema.make("reservation-1");
const now = Temporal.Instant.from("2026-06-20T08:00:00Z");

const createToken = () =>
  createReservationAccessToken(
    {
      orderId,
      locale: "en-US",
    },
    { secret, now: () => now.epochMilliseconds }
  );

describe("reservation access token", () => {
  test("opens a valid purpose-bound token", async () => {
    const token = await Effect.runPromise(createToken());
    const claims = await Effect.runPromise(
      openReservationAccessToken(
        { token, orderId, locale: "en-US" },
        { secret }
      )
    );

    expect(claims).toMatchObject({ orderId, locale: "en-US" });
  });

  test("rejects tampering and reservation or locale mismatches", async () => {
    const token = await Effect.runPromise(createToken());
    const inputs = [
      {
        token: reservationAccessTokenSchema.make(`${token}x`),
        orderId,
        locale: "en-US" as const,
      },
      {
        token,
        orderId: workspaceReservationIdSchema.make("reservation-2"),
        locale: "en-US" as const,
      },
      { token, orderId, locale: "cs-CZ" as const },
    ];

    for (const input of inputs) {
      const error = await Effect.runPromise(
        Effect.flip(openReservationAccessToken(input, { secret }))
      );
      expect(error.code).toBe("invalid-token");
    }
  });

  test("keeps links valid when checkout keys are retired", async () => {
    const token = await Effect.runPromise(createToken());
    const previousCheckoutKeys = process.env.CHECKOUT_PAY_STATE_KEYS;
    process.env.CHECKOUT_PAY_STATE_KEYS = `checkout-next:${Buffer.alloc(32, 10).toString("base64url")}`;

    try {
      const claims = await Effect.runPromise(
        openReservationAccessToken(
          { token, orderId, locale: "en-US" },
          { secret }
        )
      );

      expect(claims.orderId).toBe(orderId);
    } finally {
      process.env.CHECKOUT_PAY_STATE_KEYS = previousCheckoutKeys;
    }
  });
});
