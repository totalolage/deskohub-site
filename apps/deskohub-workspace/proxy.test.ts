import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { localeCookieName } from "@/features/i18n/routing";
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

test("prevents private reservation responses from being cached", () => {
  for (const path of [
    "/en-US/reservation/status/reservation-id?outcome=success",
    "/en-US/reservation/access/reservation-id?accessToken=sensitive",
    "/en-US/reservation/invoice/reservation-id?accessToken=sensitive",
  ]) {
    const response = proxy(new NextRequest(`https://workspace.example${path}`));

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});

test("prevents account and auth page responses from being cached", () => {
  for (const path of [
    "/en-US/account",
    "/en-US/account/deleted",
    "/cs-CZ/account",
    "/en-US/auth/sign-in",
    "/cs-CZ/auth/callback",
  ]) {
    const response = proxy(new NextRequest(`https://workspace.example${path}`));

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});

test("keeps public pages cacheable while locale switching", () => {
  const response = proxy(
    new NextRequest("https://workspace.example/cs-CZ/reservation/cowork")
  );

  expect(response.headers.get("cache-control")).toBeNull();
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
  for (const authorization of [
    primaryAdminAuthorization,
    secondaryAdminAuthorization,
  ]) {
    const response = proxy(
      new NextRequest("https://workspace.example/admin/discounts", {
        headers: { authorization },
      })
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
  }
});

test("fails closed for wrong, crossed, and unknown administrator credentials", () => {
  for (const authorization of [
    toAuthorization("admin", "operator-test-password"),
    toAuthorization("operator", "test-password"),
    toAuthorization("admin", "definitely-not-the-password"),
    toAuthorization("unknown", "test-password"),
  ]) {
    const response = proxy(
      new NextRequest("https://workspace.example/admin/discounts", {
        headers: { authorization },
      })
    );

    expect(response.status).toBe(401);
  }
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
