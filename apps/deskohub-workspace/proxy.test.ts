import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { localeCookieName } from "@/features/i18n/routing";
import { getReservationAccessCookieName } from "@/features/reservation/backend/reservation-access-cookie";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessTokenQueryParam } from "@/features/reservation/reservation-access-token";
import { workspaceTestAdministrators } from "@/shared/testing/workspace-test-environment";
import { config, proxy } from "./proxy";

const toAuthorization = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

const [primaryAdministrator, secondaryAdministrator] =
  workspaceTestAdministrators;
const primaryAdminAuthorization = toAuthorization(
  primaryAdministrator.username,
  primaryAdministrator.password
);
const secondaryAdminAuthorization = toAuthorization(
  secondaryAdministrator.username,
  secondaryAdministrator.password
);

const administrationPaths = [
  "/admin",
  "/admin/",
  "/admin/bookings",
  "/admin/bookings/booking-id",
  "/admin/reservations",
  "/admin/reservations/reservation-id",
  "/admin/customers",
  "/admin/customers/customer-id",
  "/admin/customers/customer-id/create-code",
  "/admin/discounts",
  "/admin/codes",
  "/admin/codes/code-id",
  "/admin/sales",
] as const;

describe("administration route boundary", () => {
  test("matches every administration route including dotted identifiers", () => {
    for (const pathname of [
      ...administrationPaths,
      "/admin//reservations",
      "/admin/reservations/reservation.with.dots",
      "/admin/reservations/reservation%2Ewith%2Edots",
      "/admin/customers/customer.with.dots/create-code",
    ]) {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url: `https://workspace.example${pathname}`,
        })
      ).toBe(true);
    }
  });

  test("does not classify paths with an admin-like prefix as administration", async () => {
    for (const pathname of ["/administrator", "/admin-help"]) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${pathname}`)
      );

      expect(response.status).not.toBe(401);
      expect(response.headers.get("location")).toBe(
        `https://workspace.example/en-US${pathname}`
      );
    }
  });

  test("challenges every concrete administration route", async () => {
    for (const pathname of administrationPaths) {
      const response = await proxy(
        new NextRequest(`https://workspace.example${pathname}`)
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        "Basic realm="
      );
    }
  });

  test("challenges navigation request variants consistently", async () => {
    const requests = [
      new NextRequest("https://workspace.example/admin/reservations", {
        method: "HEAD",
      }),
      new NextRequest("https://workspace.example/admin/reservations", {
        headers: { rsc: "1" },
      }),
      new NextRequest("https://workspace.example/admin/reservations", {
        headers: {
          "next-router-prefetch": "1",
          purpose: "prefetch",
        },
      }),
    ];

    for (const request of requests) {
      expect((await proxy(request)).status).toBe(401);
    }
  });
});

test("passes Server Action requests through without mutating the response", async () => {
  const request = new NextRequest(
    "https://workspace.example/en-US/checkout/pay",
    {
      method: "POST",
      headers: {
        "next-action": "action-id",
      },
    }
  );

  const response = await proxy(request);

  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.cookies.get(localeCookieName)).toBeUndefined();
});

test("continues to persist the locale for ordinary localized requests", async () => {
  const request = new NextRequest("https://workspace.example/cs-CZ");

  const response = await proxy(request);

  expect(response.cookies.get(localeCookieName)?.value).toBe("cs-CZ");
});

test("prevents private reservation responses from being cached", async () => {
  for (const path of [
    "/en-US/reservation/status/reservation-id?outcome=success",
    "/en-US/reservation/access/reservation-id?accessToken=sensitive",
    "/en-US/reservation/invoice/reservation-id?accessToken=sensitive",
  ]) {
    const response = await proxy(
      new NextRequest(`https://workspace.example${path}`)
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});

test("exchanges a valid reservation capability for a private cookie", async () => {
  const orderId = workspaceReservationIdSchema.make("reservation-id");
  const accessToken = Effect.runSync(
    createReservationAccessToken({ orderId, locale: "en-US" })
  );
  const response = await proxy(
    new NextRequest(
      `https://workspace.example/en-US/reservation/access/${orderId}?${reservationAccessTokenQueryParam}=${encodeURIComponent(accessToken)}`
    )
  );

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    `https://workspace.example/en-US/reservation/access/${orderId}`
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(
    response.cookies.get(getReservationAccessCookieName(orderId))?.value
  ).toEqual(expect.any(String));
});

test("exchanges an access capability with preview bypass params and strips credentials", async () => {
  const orderId = workspaceReservationIdSchema.make("reservation-id");
  const accessToken = Effect.runSync(
    createReservationAccessToken({ orderId, locale: "en-US" })
  );
  const url = new URL(
    `https://workspace.example/en-US/reservation/access/${orderId}`
  );
  url.searchParams.set(reservationAccessTokenQueryParam, accessToken);
  url.searchParams.set(
    "x-vercel-protection-bypass",
    "synthetic-preview-bypass"
  );
  url.searchParams.set("x-vercel-set-bypass-cookie", "true");

  const response = await proxy(new NextRequest(url));

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    `https://workspace.example/en-US/reservation/access/${orderId}`
  );
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(
    response.cookies.get(getReservationAccessCookieName(orderId))?.value
  ).toEqual(expect.any(String));
});

test("rejects malformed access preview bypass params without leaking credentials", async () => {
  const orderId = workspaceReservationIdSchema.make("reservation-id");
  const accessToken = Effect.runSync(
    createReservationAccessToken({ orderId, locale: "en-US" })
  );
  const malformedQuery = [
    (url: URL) => url.searchParams.set("redirect", "https://evil.example"),
    (url: URL) => {
      url.searchParams.append("x-vercel-protection-bypass", "synthetic-one");
      url.searchParams.append("x-vercel-protection-bypass", "synthetic-two");
    },
    (url: URL) => {
      url.searchParams.append("x-vercel-set-bypass-cookie", "true");
      url.searchParams.append("x-vercel-set-bypass-cookie", "true");
    },
    (url: URL) => url.searchParams.set("x-vercel-set-bypass-cookie", "false"),
    (url: URL) => url.searchParams.set("outcome", "success"),
  ];

  for (const addMalformedParam of malformedQuery) {
    const url = new URL(
      `https://workspace.example/en-US/reservation/access/${orderId}`
    );
    url.searchParams.set(reservationAccessTokenQueryParam, accessToken);
    addMalformedParam(url);

    const response = await proxy(new NextRequest(url));

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(
      response.cookies.get(getReservationAccessCookieName(orderId))
    ).toBeUndefined();
  }
});

test("keeps the legacy reservation capability bound to its issuance locale", async () => {
  const orderId = workspaceReservationIdSchema.make("reservation-id");
  const accessToken = Effect.runSync(
    createReservationAccessToken({ orderId, locale: "en-US" })
  );
  const response = await proxy(
    new NextRequest(
      `https://workspace.example/cs-CZ/reservation/access/${orderId}?${reservationAccessTokenQueryParam}=${encodeURIComponent(accessToken)}`
    )
  );

  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(
    response.cookies.get(getReservationAccessCookieName(orderId))
  ).toBeUndefined();
});

test("rejects invalid reservation capability exchanges without setting a cookie", async () => {
  const orderId = workspaceReservationIdSchema.make("reservation-id");
  const response = await proxy(
    new NextRequest(
      `https://workspace.example/en-US/reservation/access/${orderId}?${reservationAccessTokenQueryParam}=invalid`
    )
  );

  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(
    response.cookies.get(getReservationAccessCookieName(orderId))
  ).toBeUndefined();
});

test("prevents account and auth page responses from being cached", async () => {
  for (const path of [
    "/en-US/account",
    "/en-US/account/deleted",
    "/cs-CZ/account",
    "/en-US/auth/sign-in",
    "/cs-CZ/auth/callback",
  ]) {
    const response = await proxy(
      new NextRequest(`https://workspace.example${path}`)
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});

test("keeps public pages cacheable while locale switching", async () => {
  const response = await proxy(
    new NextRequest("https://workspace.example/cs-CZ/reservation/cowork")
  );

  expect(response.headers.get("cache-control")).toBeNull();
});

test("does not treat a GET with a spoofed action header as a Server Action", async () => {
  const request = new NextRequest("https://workspace.example/", {
    headers: {
      "next-action": "spoofed-action-id",
    },
  });

  const response = await proxy(request);

  expect(response.headers.get("location")).toBe(
    "https://workspace.example/en-US"
  );
});

test("challenges unauthenticated administration requests", async () => {
  const response = await proxy(
    new NextRequest("https://workspace.example/admin/discounts")
  );

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("Basic realm=");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Authorization");
});

test("passes authenticated administration requests without localization", async () => {
  for (const authorization of [
    primaryAdminAuthorization,
    secondaryAdminAuthorization,
  ]) {
    const response = await proxy(
      new NextRequest("https://workspace.example/admin/discounts", {
        headers: { authorization },
      })
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
  }
});

test("fails closed for wrong, crossed, and unknown administrator credentials", async () => {
  for (const authorization of [
    toAuthorization("admin", "operator-test-password"),
    toAuthorization("operator", "test-password"),
    toAuthorization("admin", "definitely-not-the-password"),
    toAuthorization("unknown", "test-password"),
  ]) {
    const response = await proxy(
      new NextRequest("https://workspace.example/admin/discounts", {
        headers: { authorization },
      })
    );

    expect(response.status).toBe(401);
  }
});

test("checks administration Server Action posts before the general pass-through", async () => {
  const unauthorized = await proxy(
    new NextRequest("https://workspace.example/admin/discounts", {
      method: "POST",
      headers: { "next-action": "action-id" },
    })
  );
  const authorized = await proxy(
    new NextRequest("https://workspace.example/admin/discounts", {
      method: "POST",
      headers: {
        authorization: primaryAdminAuthorization,
        "next-action": "action-id",
      },
    })
  );

  expect(unauthorized.status).toBe(401);
  expect(authorized.headers.get("x-middleware-next")).toBe("1");
});

test("test authentication fixtures match the configured credential registry contract", () => {
  const configuredCredentials = (
    process.env.ADMIN_BASIC_AUTH_CREDENTIALS ?? ""
  ).split(/\r?\n/);

  expect(configuredCredentials).toHaveLength(
    workspaceTestAdministrators.length
  );
  for (const { username, password } of workspaceTestAdministrators) {
    expect(configuredCredentials).toContain(
      `${username}:${createHash("sha256")
        .update(`${username}:${password}`)
        .digest("hex")}`
    );
  }
});
