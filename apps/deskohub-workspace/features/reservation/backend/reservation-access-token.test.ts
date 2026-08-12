import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  type CheckoutStateKey,
  checkoutStateKeyIdSchema,
} from "@/features/checkout/backend/checkout/checkout-state-token";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  createReservationAccessToken,
  openReservationAccessToken,
} from "./reservation-access-token";

const keys: readonly CheckoutStateKey[] = [
  {
    kid: checkoutStateKeyIdSchema.make("access-test"),
    key: Buffer.alloc(32, 9),
  },
];
const orderId = workspaceReservationIdSchema.make("reservation-1");
const now = Temporal.Instant.from("2026-06-20T08:00:00Z");

const createToken = () =>
  createReservationAccessToken(
    {
      orderId,
      locale: "en-US",
    },
    { keys, now: () => now.epochMilliseconds }
  );

describe("reservation access token", () => {
  test("opens a valid purpose-bound token", async () => {
    const token = await Effect.runPromise(createToken());
    const claims = await Effect.runPromise(
      openReservationAccessToken({ token, orderId, locale: "en-US" }, { keys })
    );

    expect(claims).toMatchObject({ orderId, locale: "en-US", version: 1 });
  });

  test("rejects tampering and reservation or locale mismatches", async () => {
    const token = await Effect.runPromise(createToken());
    const inputs = [
      { token: `${token}x`, orderId, locale: "en-US" as const },
      {
        token,
        orderId: workspaceReservationIdSchema.make("reservation-2"),
        locale: "en-US" as const,
      },
      { token, orderId, locale: "cs-CZ" as const },
    ];

    for (const input of inputs) {
      const error = await Effect.runPromise(
        Effect.flip(openReservationAccessToken(input, { keys }))
      );
      expect(error.code).toBe("invalid-token");
    }
  });

  test("keeps links valid while their signing key remains in the rotated keyring", async () => {
    const token = await Effect.runPromise(createToken());
    const rotatedKeys: readonly CheckoutStateKey[] = [
      {
        kid: checkoutStateKeyIdSchema.make("access-next"),
        key: Buffer.alloc(32, 10),
      },
      ...keys,
    ];

    const claims = await Effect.runPromise(
      openReservationAccessToken(
        { token, orderId, locale: "en-US" },
        { keys: rotatedKeys }
      )
    );

    expect(claims.kid).toBe("access-test");
  });
});
