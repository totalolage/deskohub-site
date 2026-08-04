import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { env } from "@/env";
import { localeCookieName } from "@/features/i18n/routing";
import { proxy } from "./proxy";

const adminAuthorization = `Basic ${Buffer.from("admin:test-password").toString("base64")}`;

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

test("limits synthetic preview bypass to fixture-backed read-only pages", () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  const previousFixtureSetting = env.ADMIN_PREVIEW_FIXTURES;
  process.env.NODE_ENV = "development";
  Object.assign(env, { ADMIN_PREVIEW_FIXTURES: "true" });

  try {
    const fixturePage = proxy(
      new NextRequest("https://workspace.example/admin/reservations/example")
    );
    const fixtureBookingPage = proxy(
      new NextRequest("https://workspace.example/admin/bookings/example")
    );
    const livePage = proxy(
      new NextRequest("https://workspace.example/admin/discounts")
    );
    const mutation = proxy(
      new NextRequest("https://workspace.example/admin/reservations/example", {
        method: "POST",
        headers: { "next-action": "action-id" },
      })
    );

    expect(fixturePage.headers.get("x-middleware-next")).toBe("1");
    expect(fixtureBookingPage.headers.get("x-middleware-next")).toBe("1");
    expect(livePage.status).toBe(401);
    expect(mutation.status).toBe(401);
  } finally {
    process.env.NODE_ENV = previousNodeEnvironment;
    Object.assign(env, { ADMIN_PREVIEW_FIXTURES: previousFixtureSetting });
  }
});

test("test authentication fixture matches the configured hash contract", () => {
  expect(createHash("sha256").update("admin:test-password").digest("hex")).toBe(
    process.env.ADMIN_BASIC_AUTH_SHA256
  );
});
