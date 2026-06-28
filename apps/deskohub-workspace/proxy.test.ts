import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

describe("proxy", () => {
  test("redirects checkout order payment returns before page hydration", () => {
    const token = "a".repeat(43);
    const response = proxy(
      new NextRequest(
        `https://workspace.example.test/en-US/checkout/order?paymentOrderId=order_123&checkoutToken=${token}`
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://workspace.example.test/en-US/checkout/status/order_123?checkoutToken=${token}`
    );
  });

  test("preserves Vercel bypass params on checkout return redirects", () => {
    const token = "a".repeat(43);
    const response = proxy(
      new NextRequest(
        `https://workspace.example.test/en-US/checkout/order?paymentOrderId=order_123&checkoutToken=${token}&x-vercel-protection-bypass=preview-secret`
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://workspace.example.test/en-US/checkout/status/order_123?checkoutToken=${token}&x-vercel-protection-bypass=preview-secret&x-vercel-set-bypass-cookie=true`
    );
  });
});
