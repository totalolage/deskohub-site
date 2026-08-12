import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { localeCookieName } from "@/features/i18n/routing";
import { config, proxy } from "./proxy";

const adminAuthorization = `Basic ${Buffer.from("admin:test-password").toString("base64")}`;

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

  test("does not classify paths with an admin-like prefix as administration", () => {
    for (const pathname of ["/administrator", "/admin-help"]) {
      const response = proxy(
        new NextRequest(`https://workspace.example${pathname}`)
      );

      expect(response.status).not.toBe(401);
      expect(response.headers.get("location")).toBe(
        `https://workspace.example/en-US${pathname}`
      );
    }
  });

  test("challenges every concrete administration route", () => {
    for (const pathname of administrationPaths) {
      const response = proxy(
        new NextRequest(`https://workspace.example${pathname}`)
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        "Basic realm="
      );
    }
  });

  test("challenges navigation request variants consistently", () => {
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
      expect(proxy(request).status).toBe(401);
    }
  });
});

test("passes Server Action requests through without mutating the response", () => {
  const request = new NextRequest(
    "https://workspace.example/en-US/checkout/pay",
    {
      method: "POST",
      headers: {
        "next-action": "action-id",
      },
    }
  );

  const response = proxy(request);

  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.cookies.get(localeCookieName)).toBeUndefined();
});

test("continues to persist the locale for ordinary localized requests", () => {
  const request = new NextRequest("https://workspace.example/cs-CZ");

  const response = proxy(request);

  expect(response.cookies.get(localeCookieName)?.value).toBe("cs-CZ");
});

test("redirects localized account requests to the matching magic-link page", async () => {
  const request = new NextRequest(
    "https://workspace.example/cs-CZ/account?section=reservations"
  );
  const response = await proxy(request);

  expect(response.status).toBe(307);
  const location = new URL(response.headers.get("location") ?? "");
  expect(location.pathname).toBe("/cs-CZ/auth/sign-in");
  expect(location.searchParams.get("redirectTo")).toBe(
    "/cs-CZ/account?section=reservations"
  );
  expect(response.cookies.get(localeCookieName)?.value).toBe("cs-CZ");
});

test("does not treat a GET with a spoofed action header as a Server Action", () => {
  const request = new NextRequest("https://workspace.example/", {
    headers: {
      "next-action": "spoofed-action-id",
    },
  });

  const response = proxy(request);

  expect(response.headers.get("location")).toBe(
    "https://workspace.example/en-US"
  );
});

test("challenges unauthenticated administration requests", () => {
  const response = proxy(
    new NextRequest("https://workspace.example/admin/discounts")
  );

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("Basic realm=");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Authorization");
});

test("passes authenticated administration requests without localization", () => {
  const response = proxy(
    new NextRequest("https://workspace.example/admin/discounts", {
      headers: { authorization: adminAuthorization },
    })
  );

  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Authorization");
});

test("checks administration Server Action posts before the general pass-through", () => {
  const unauthorized = proxy(
    new NextRequest("https://workspace.example/admin/discounts", {
      method: "POST",
      headers: { "next-action": "action-id" },
    })
  );
  const authorized = proxy(
    new NextRequest("https://workspace.example/admin/discounts", {
      method: "POST",
      headers: {
        authorization: adminAuthorization,
        "next-action": "action-id",
      },
    })
  );

  expect(unauthorized.status).toBe(401);
  expect(authorized.headers.get("x-middleware-next")).toBe("1");
});

test("test authentication fixture matches the configured hash contract", () => {
  expect(createHash("sha256").update("admin:test-password").digest("hex")).toBe(
    process.env.ADMIN_BASIC_AUTH_SHA256
  );
});
