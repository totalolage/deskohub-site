import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
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

// The token this module issues for these inputs today. Access links already
// sent must keep opening, so the format can't change.
const goldenToken =
  "eyJwdXJwb3NlIjoicmVzZXJ2YXRpb24tYWNjZXNzIiwib3JkZXJJZCI6InJlc2VydmF0aW9uLTEiLCJsb2NhbGUiOiJlbi1VUyIsImlzc3VlZEF0RXBvY2hNaWxsaXNlY29uZHMiOjE3ODE5NDI0MDAwMDB9.bdiqEW-XmvyeCmoctnVagNsr-L4Tm3s0Fym2bp1pD6w";

const openToken = (token: string, options: { secret?: string | Buffer }) =>
  openReservationAccessToken(
    {
      token: reservationAccessTokenSchema.make(token),
      orderId,
      locale: "en-US",
    },
    options
  );

/** The golden claims signed with `key` for `purpose`. */
const signGoldenClaims = (key: Buffer, purpose = "reservation-access") => {
  const [encodedClaims] = goldenToken.split(".");
  return `${encodedClaims}.${createHmac("sha256", key)
    .update(`${purpose}.${encodedClaims}`)
    .digest("base64url")}`;
};

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

  test("keeps the issued token format", async () => {
    expect(await Effect.runPromise(createToken())).toBe(goldenToken);
    expect(
      await Effect.runPromise(
        openReservationAccessToken(
          {
            token: reservationAccessTokenSchema.make(goldenToken),
            orderId,
            locale: "en-US",
          },
          { secret }
        )
      )
    ).toEqual({
      purpose: "reservation-access",
      orderId,
      locale: "en-US",
      issuedAtEpochMilliseconds: now.epochMilliseconds,
    });
  });

  test("reproduces identical bytes for the same issuance timestamp input", async () => {
    const first = await Effect.runPromise(createToken());
    const second = await Effect.runPromise(createToken());

    expect(second).toBe(first);
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

  test("rejects unreadable or unexpected claims as an invalid token", async () => {
    const token = await Effect.runPromise(createToken());
    const [, signature] = token.split(".");
    const encode = (claims: string) =>
      Buffer.from(claims).toString("base64url");

    for (const encodedClaims of [
      encode("not json"),
      encode(JSON.stringify({ purpose: "reservation-access", orderId })),
    ]) {
      const error = await Effect.runPromise(
        Effect.flip(
          openReservationAccessToken(
            {
              token: reservationAccessTokenSchema.make(
                `${encodedClaims}.${signature}`
              ),
              orderId,
              locale: "en-US",
            },
            { secret }
          )
        )
      );
      expect(error.code).toBe("invalid-token");
      expect(error.message).toBe("Reservation access token is invalid.");
      expect(error.cause).toBeDefined();
    }
  });

  test("requires a secret of at least 32 bytes to issue or open a token", async () => {
    for (const [configuredSecret, code] of [
      ["", "missing-secret"],
      [Buffer.alloc(31, 9), "invalid-secret"],
    ] as const) {
      const issued = await Effect.runPromise(
        Effect.flip(
          createReservationAccessToken(
            { orderId, locale: "en-US" },
            { secret: configuredSecret }
          )
        )
      );
      const opened = await Effect.runPromise(
        Effect.flip(openToken(goldenToken, { secret: configuredSecret }))
      );
      expect(issued.code).toBe(code);
      expect(opened.code).toBe(code);
    }
  });

  test("rejects a malformed token as invalid before reading the secret", async () => {
    const [encodedClaims, signature = ""] = goldenToken.split(".");

    for (const token of [
      `${goldenToken}.extra`,
      `${encodedClaims}.${signature.slice(0, -1)}`,
      encodedClaims,
    ]) {
      const error = await Effect.runPromise(
        Effect.flip(openToken(token, { secret: "" }))
      );
      expect(error.code).toBe("invalid-token");
      expect(error.message).toBe("Reservation access token is invalid.");
    }
  });

  test("rejects a token signed with another key or for another purpose", async () => {
    for (const token of [
      signGoldenClaims(Buffer.alloc(32, 10)),
      signGoldenClaims(secret, "reservation-access-cookie"),
    ]) {
      const error = await Effect.runPromise(
        Effect.flip(openToken(token, { secret }))
      );
      expect(error.code).toBe("invalid-token");
      expect(error.message).toBe("Reservation access token is invalid.");
    }
    expect(signGoldenClaims(secret)).toBe(goldenToken);
  });

  test("refuses to issue a token with an invalid issuance time", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        createReservationAccessToken(
          { orderId, locale: "en-US" },
          { secret, now: () => -1 }
        )
      )
    );

    expect(error.code).toBe("invalid-token");
    expect(error.message).toBe("Reservation access token claims are invalid.");
  });
});
