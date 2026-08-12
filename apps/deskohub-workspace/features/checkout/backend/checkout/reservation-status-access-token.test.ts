import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  createReservationStatusAccessToken,
  openReservationStatusAccessToken,
} from "./reservation-status-access-token";

const secret = "synthetic-reservation-status-secret";
const orderId = workspaceReservationIdSchema.make("reservation-1");
const now = Temporal.Instant.from("2026-06-20T08:00:00Z");

const createToken = () =>
  createReservationStatusAccessToken(
    {
      orderId,
      locale: "en-US",
      expiresAt: Temporal.Instant.from("2026-06-20T12:30:00Z"),
    },
    { secret, now: () => now.epochMilliseconds }
  );

describe("reservation status access token", () => {
  test("opens a valid purpose-bound token", async () => {
    const token = await Effect.runPromise(createToken());
    const claims = await Effect.runPromise(
      openReservationStatusAccessToken(
        { token, orderId, locale: "en-US", now },
        { secret }
      )
    );

    expect(claims).toMatchObject({ orderId, locale: "en-US", version: 1 });
  });

  test("rejects tampering and reservation or locale mismatches", async () => {
    const token = await Effect.runPromise(createToken());
    const inputs = [
      { token: `${token}x`, orderId, locale: "en-US" as const, now },
      {
        token,
        orderId: workspaceReservationIdSchema.make("reservation-2"),
        locale: "en-US" as const,
        now,
      },
      { token, orderId, locale: "cs-CZ" as const, now },
    ];

    for (const input of inputs) {
      const error = await Effect.runPromise(
        Effect.flip(openReservationStatusAccessToken(input, { secret }))
      );
      expect(error.code).toBe("invalid-token");
    }
  });

  test("expires exactly at the trailing access-window boundary", async () => {
    const token = await Effect.runPromise(createToken());
    const error = await Effect.runPromise(
      Effect.flip(
        openReservationStatusAccessToken(
          {
            token,
            orderId,
            locale: "en-US",
            now: Temporal.Instant.from("2026-06-20T12:30:00Z"),
          },
          { secret }
        )
      )
    );

    expect(error.code).toBe("expired");
  });
});
