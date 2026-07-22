import { expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { localeCookieName } from "@/features/i18n/routing";
import { proxy } from "./proxy";

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
