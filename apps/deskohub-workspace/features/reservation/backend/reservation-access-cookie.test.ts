import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  createReservationAccessCookieCapability,
  getReservationAccessCookieName,
  openReservationAccessCookie,
  parseCanonicalReservationAccessUrl,
  parseCanonicalReservationStatusUrl,
  reservationAccessCookieMaxAgeMilliseconds,
  reservationAccessCookieMaxAgeSeconds,
  sealReservationAccessCookie,
  writeReservationAccessCookie,
} from "./reservation-access-cookie";
import {
  openReservationAccessToken,
  type ReservationAccessToken,
} from "./reservation-access-token";

const secret = Buffer.alloc(32, 13);
const orderId = workspaceReservationIdSchema.make("reservation-cookie-1");
const otherOrderId = workspaceReservationIdSchema.make("reservation-cookie-2");
const now = 1_800_000_000_000;
const capability = await Effect.runPromise(
  createReservationAccessCookieCapability(
    { orderId, locale: "en-US" },
    { now: () => now, secret }
  )
);

const seal = () =>
  Effect.runPromise(
    sealReservationAccessCookie(
      { orderId, capability },
      { now: () => now, secret }
    )
  );

describe("reservation access cookie", () => {
  test("uses a distinct host-only cookie name for each reservation", () => {
    expect(getReservationAccessCookieName(orderId)).toMatch(
      /^__Host-deskohub-reservation-access-/
    );
    expect(getReservationAccessCookieName(orderId)).not.toBe(
      getReservationAccessCookieName(otherOrderId)
    );
  });

  test("writes a signed secure bounded cookie", async () => {
    const value = await seal();
    const writes: unknown[] = [];

    await Effect.runPromise(
      writeReservationAccessCookie(
        {
          set: (...args) => writes.push(args),
        },
        { orderId, capability },
        { now: () => now, secret }
      )
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual([
      getReservationAccessCookieName(orderId),
      value,
      {
        expires: new Date(now + reservationAccessCookieMaxAgeMilliseconds),
        httpOnly: true,
        maxAge: reservationAccessCookieMaxAgeSeconds,
        path: "/",
        sameSite: "lax",
        secure: true,
      },
    ]);
  });

  test("contains only cookie details and is not a legacy invoice capability", async () => {
    const value = await seal();
    const [encodedClaims] = value.split(".");
    const claims = JSON.parse(
      Buffer.from(encodedClaims ?? "", "base64url").toString("utf8")
    ) as { readonly token?: unknown };

    expect(Object.keys(claims).sort()).toEqual([
      "expiresAtEpochMilliseconds",
      "issuedAtEpochMilliseconds",
      "locale",
      "orderId",
      "purpose",
    ]);
    expect(claims).not.toHaveProperty("token");
    await expect(
      Effect.runPromise(
        openReservationAccessToken(
          {
            token: value as ReservationAccessToken,
            orderId,
            locale: "en-US",
          },
          { secret }
        )
      )
    ).rejects.toMatchObject({ code: "invalid-token" });
  });

  test("rejects tampering, wrong reservations, and expiry", async () => {
    const value = await seal();
    const tampered = `${value}x`;

    for (const input of [
      { value: tampered, orderId },
      { value, orderId: otherOrderId },
    ]) {
      await expect(
        Effect.runPromise(
          openReservationAccessCookie(input, { now: () => now, secret })
        )
      ).rejects.toMatchObject({ code: "invalid-cookie" });
    }

    await expect(
      Effect.runPromise(
        openReservationAccessCookie(
          { value, orderId },
          {
            now: () => now + reservationAccessCookieMaxAgeMilliseconds,
            secret,
          }
        )
      )
    ).rejects.toMatchObject({ code: "expired-cookie" });
  });

  test("retains the capability issuance locale across later locale navigation", async () => {
    const value = await seal();

    await expect(
      Effect.runPromise(
        openReservationAccessCookie(
          { value, orderId },
          { now: () => now + 1_000, secret }
        )
      )
    ).resolves.toEqual(capability);
  });

  test("does not renew expiration when existing cookie details are resealed", async () => {
    const value = await seal();
    const details = await Effect.runPromise(
      openReservationAccessCookie(
        { value, orderId },
        { now: () => now + 1_000, secret }
      )
    );
    const resealed = await Effect.runPromise(
      sealReservationAccessCookie(
        { orderId, capability: details },
        { now: () => now + 1_000, secret }
      )
    );

    expect(resealed).toBe(value);
    await expect(
      Effect.runPromise(
        openReservationAccessCookie(
          { value: resealed, orderId },
          {
            now: () => now + reservationAccessCookieMaxAgeMilliseconds,
            secret,
          }
        )
      )
    ).rejects.toMatchObject({ code: "expired-cookie" });
  });

  test("does not renew the browser lifetime when existing details are rewritten", async () => {
    const writes: unknown[] = [];

    await Effect.runPromise(
      writeReservationAccessCookie(
        {
          set: (...args) => writes.push(args),
        },
        { orderId, capability },
        { now: () => now + 1_000, secret }
      )
    );

    expect(writes[0]).toEqual([
      getReservationAccessCookieName(orderId),
      await seal(),
      {
        expires: new Date(now + reservationAccessCookieMaxAgeMilliseconds),
        httpOnly: true,
        maxAge: reservationAccessCookieMaxAgeSeconds - 1,
        path: "/",
        sameSite: "lax",
        secure: true,
      },
    ]);
  });

  test("parses only a fixed localized status URL", () => {
    expect(
      parseCanonicalReservationStatusUrl(
        `/en-US/reservation/status/${orderId}?outcome=success`,
        "en-US"
      )
    ).toBe(orderId);
    expect(
      parseCanonicalReservationStatusUrl(
        `/en-US/reservation/status/${orderId}?x-vercel-protection-bypass=synthetic&x-vercel-set-bypass-cookie=true`,
        "en-US"
      )
    ).toBe(orderId);

    for (const value of [
      `https://evil.example/en-US/reservation/status/${orderId}`,
      `/cs-CZ/reservation/status/${orderId}`,
      `/en-US/reservation/access/${orderId}`,
      `/en-US/reservation/status/${orderId}?accessToken=secret`,
      `/en-US/reservation/status/${orderId}?redirect=https://evil.example`,
      `/en-US/reservation/status/${orderId}?x-vercel-protection-bypass=synthetic-one&x-vercel-protection-bypass=synthetic-two`,
      `/en-US/reservation/status/${orderId}?x-vercel-set-bypass-cookie=false`,
      `/en-US/reservation/status/${orderId}?x-vercel-set-bypass-cookie=true&x-vercel-set-bypass-cookie=true`,
      `/en-US/reservation/status/${orderId}/extra`,
    ]) {
      expect(
        parseCanonicalReservationStatusUrl(value, "en-US")
      ).toBeUndefined();
    }
  });

  test("parses an access URL with only valid preview protection params", () => {
    expect(
      parseCanonicalReservationAccessUrl(
        `/en-US/reservation/access/${orderId}?x-vercel-protection-bypass=synthetic&x-vercel-set-bypass-cookie=true`,
        "en-US"
      )
    ).toBe(orderId);

    for (const value of [
      `/en-US/reservation/access/${orderId}?outcome=success`,
      `/en-US/reservation/access/${orderId}?redirect=https://evil.example`,
      `/en-US/reservation/access/${orderId}?x-vercel-protection-bypass=synthetic-one&x-vercel-protection-bypass=synthetic-two`,
      `/en-US/reservation/access/${orderId}?x-vercel-set-bypass-cookie=false`,
      `/en-US/reservation/access/${orderId}?x-vercel-set-bypass-cookie=true&x-vercel-set-bypass-cookie=true`,
    ]) {
      expect(
        parseCanonicalReservationAccessUrl(value, "en-US")
      ).toBeUndefined();
    }
  });
});
