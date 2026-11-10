import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Effect } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  createReservationAccessCookieCapability,
  getReservationAccessCookieName,
  openReservationAccessCookie,
  parseCanonicalReservationAccessUrl,
  parseCanonicalReservationStatusUrl,
  readReservationAccessCookie,
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

// The cookie value this module seals for these inputs today. Cookies already
// set must keep opening, so the format can't change.
const goldenCookie =
  "eyJwdXJwb3NlIjoicmVzZXJ2YXRpb24tYWNjZXNzLWNvb2tpZSIsIm9yZGVySWQiOiJyZXNlcnZhdGlvbi1jb29raWUtMSIsImxvY2FsZSI6ImVuLVVTIiwiaXNzdWVkQXRFcG9jaE1pbGxpc2Vjb25kcyI6MTgwMDAwMDAwMDAwMCwiZXhwaXJlc0F0RXBvY2hNaWxsaXNlY29uZHMiOjE4MDAwODY0MDAwMDB9.c3MfbVwwPajdDx1ZJgqAV55ibefyWnryxfZrNYlC88A";

const seal = () =>
  Effect.runPromise(
    sealReservationAccessCookie(
      { orderId, capability },
      { now: () => now, secret }
    )
  );

const openFailure = (
  input: { readonly value: string; readonly orderId: typeof orderId },
  options: {
    readonly secret?: string | Buffer;
    readonly now?: () => number;
  } = {
    now: () => now,
    secret,
  }
) =>
  Effect.runPromise(Effect.flip(openReservationAccessCookie(input, options)));

/** Signs encoded claims with `key` for `purpose`, as the cookie format does. */
const signEncodedClaims = (
  encodedClaims: string,
  key = secret,
  purpose = "reservation-access-cookie"
) =>
  `${encodedClaims}.${createHmac("sha256", key)
    .update(`${purpose}.${encodedClaims}`)
    .digest("base64url")}`;

/** Seals arbitrary claims the way the cookie format signs them. */
const sealClaims = (
  claims: Readonly<Record<string, string | number | boolean>>
) =>
  signEncodedClaims(Buffer.from(JSON.stringify(claims)).toString("base64url"));

const validClaims = {
  purpose: "reservation-access-cookie",
  orderId,
  locale: "en-US",
  issuedAtEpochMilliseconds: now,
  expiresAtEpochMilliseconds: now + reservationAccessCookieMaxAgeMilliseconds,
};

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

  test("keeps the sealed cookie format", async () => {
    expect(await seal()).toBe(goldenCookie);
    expect(
      await Effect.runPromise(
        openReservationAccessCookie(
          { value: goldenCookie, orderId },
          { now: () => now, secret }
        )
      )
    ).toEqual(capability);
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

  test("rejects malformed or slash-encoded reservation path segments and fragments", () => {
    for (const segment of ["%E0%A4%A", "reservation%2Fcookie-1"]) {
      expect(
        parseCanonicalReservationStatusUrl(
          `/en-US/reservation/status/${segment}`,
          "en-US"
        )
      ).toBeUndefined();
      expect(
        parseCanonicalReservationAccessUrl(
          `/en-US/reservation/access/${segment}`,
          "en-US"
        )
      ).toBeUndefined();
    }

    expect(
      parseCanonicalReservationStatusUrl(
        `/en-US/reservation/status/${orderId}#fragment`,
        "en-US"
      )
    ).toBeUndefined();
    expect(
      parseCanonicalReservationAccessUrl(
        `/en-US/reservation/access/${orderId}#fragment`,
        "en-US"
      )
    ).toBeUndefined();
  });

  test("reports a missing or too short signing secret", async () => {
    const value = await seal();

    for (const [unusableSecret, code] of [
      ["", "missing-secret"],
      [Buffer.alloc(16, 13), "invalid-secret"],
    ] as const) {
      await expect(
        Effect.runPromise(
          sealReservationAccessCookie(
            { orderId, capability },
            { now: () => now, secret: unusableSecret }
          )
        )
      ).rejects.toMatchObject({ _tag: "ReservationAccessCookieError", code });
      expect(
        await openFailure(
          { value, orderId },
          { now: () => now, secret: unusableSecret }
        )
      ).toMatchObject({ _tag: "ReservationAccessCookieError", code });
    }
  });

  test("rejects a malformed cookie before reading the secret", async () => {
    const value = await seal();
    const [encodedClaims, encodedSignature] = value.split(".");

    for (const malformed of [
      "",
      encodedClaims,
      `${encodedClaims}.`,
      `.${encodedSignature}`,
      `${value}.extra`,
      `${Buffer.from("not json").toString("base64url")}.${encodedSignature}`,
      `${encodedClaims}.${encodedSignature?.slice(0, -1)}`,
      `${value}=`,
      `${Buffer.from([0xff, 0xfe]).toString("base64url")}.${encodedSignature}`,
    ]) {
      expect(
        await openFailure(
          { value: malformed ?? "", orderId },
          { now: () => now, secret: "" }
        )
      ).toMatchObject({
        code: "invalid-cookie",
        message: "Reservation access cookie is invalid.",
      });
    }
  });

  test("rejects claims that don't match the cookie schema", async () => {
    for (const claims of [
      { ...validClaims, purpose: "reservation-access-token" },
      { ...validClaims, locale: "fr-FR" },
      { ...validClaims, issuedAtEpochMilliseconds: -1 },
      { ...validClaims, invoiceAccess: true },
    ]) {
      expect(
        await openFailure({ value: sealClaims(claims), orderId })
      ).toMatchObject({ code: "invalid-cookie" });
    }
  });

  test("rejects a signature from another secret, for another purpose or of another length", async () => {
    const value = await seal();
    const [encodedClaims = ""] = value.split(".");
    const otherSecretCookie = signEncodedClaims(
      encodedClaims,
      Buffer.alloc(32, 14)
    );

    expect(signEncodedClaims(encodedClaims)).toBe(value);
    for (const forged of [
      otherSecretCookie,
      signEncodedClaims(encodedClaims, secret, "reservation-access"),
      otherSecretCookie.slice(0, encodedClaims.length + 21),
    ]) {
      expect(await openFailure({ value: forged, orderId })).toMatchObject({
        code: "invalid-cookie",
        message: "Reservation access cookie is invalid.",
      });
    }
  });

  test("opens validly signed claims and rejects an impossible lifetime", async () => {
    expect(
      await Effect.runPromise(
        openReservationAccessCookie(
          { value: sealClaims(validClaims), orderId },
          { now: () => now, secret }
        )
      )
    ).toEqual({
      orderId,
      locale: "en-US",
      issuedAtEpochMilliseconds: now,
      expiresAtEpochMilliseconds:
        now + reservationAccessCookieMaxAgeMilliseconds,
    });

    for (const claims of [
      { ...validClaims, issuedAtEpochMilliseconds: now + 1 },
      { ...validClaims, expiresAtEpochMilliseconds: now },
      {
        ...validClaims,
        issuedAtEpochMilliseconds: now - 1,
        expiresAtEpochMilliseconds:
          now + reservationAccessCookieMaxAgeMilliseconds,
      },
    ]) {
      expect(
        await openFailure({ value: sealClaims(claims), orderId })
      ).toMatchObject({ code: "expired-cookie" });
    }
  });

  test("rejects sealing a capability for another reservation or after expiry", async () => {
    await expect(
      Effect.runPromise(
        sealReservationAccessCookie(
          { orderId: otherOrderId, capability },
          { now: () => now, secret }
        )
      )
    ).rejects.toMatchObject({ code: "invalid-cookie" });
    await expect(
      Effect.runPromise(
        sealReservationAccessCookie(
          { orderId, capability },
          {
            now: () => capability.expiresAtEpochMilliseconds,
            secret,
          }
        )
      )
    ).rejects.toMatchObject({ code: "expired-cookie" });
  });

  test("accepts each known status outcome and rejects any other", () => {
    for (const outcome of ["success", "cancelled"]) {
      expect(
        parseCanonicalReservationStatusUrl(
          `/en-US/reservation/status/${orderId}?outcome=${outcome}`,
          "en-US"
        )
      ).toBe(orderId);
    }
    expect(
      parseCanonicalReservationStatusUrl(
        `/cs-CZ/reservation/status/${orderId}`,
        "cs-CZ"
      )
    ).toBe(orderId);

    for (const value of [
      `/en-US/reservation/status/${orderId}?outcome=failed`,
      `/en-US/reservation/status/${orderId}?outcome=`,
      `/en-US/reservation/status/${orderId}?outcome=success&outcome=success`,
    ]) {
      expect(
        parseCanonicalReservationStatusUrl(value, "en-US")
      ).toBeUndefined();
    }
  });

  test("rejects non-relative, misshaped, and other-locale reservation URLs", () => {
    for (const [route, parse] of [
      ["status", parseCanonicalReservationStatusUrl],
      ["access", parseCanonicalReservationAccessUrl],
    ] as const) {
      expect(parse(`/en-US/reservation/${route}/${orderId}`, "en-US")).toBe(
        orderId
      );

      for (const value of [
        `en-US/reservation/${route}/${orderId}`,
        `//evil.example/en-US/reservation/${route}/${orderId}`,
        `/en-US/reservation/${route}/`,
        `/en-US/reservation/${route}`,
        `/en-US/reservations/${route}/${orderId}`,
        `/en-US/${route}/reservation/${orderId}`,
        `/xx-XX/reservation/${route}/${orderId}`,
        `/cs-CZ/reservation/${route}/${orderId}`,
      ]) {
        expect(parse(value, "en-US")).toBeUndefined();
      }
    }
  });

  test("reads the cookie stored under the reservation's cookie name", () => {
    const cookies = new Map([
      [getReservationAccessCookieName(orderId), { value: "sealed-value" }],
    ]);
    const store = { get: (name: string) => cookies.get(name) };

    expect(readReservationAccessCookie(store, orderId)).toBe("sealed-value");
    expect(readReservationAccessCookie(store, otherOrderId)).toBeUndefined();
  });
});
