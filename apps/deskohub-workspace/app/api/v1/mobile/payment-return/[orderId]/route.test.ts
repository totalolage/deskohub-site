import { describe, expect, test } from "bun:test";
import { GET } from "./route";

describe("mobile shop payment return", () => {
  test("keeps preview returns on the connected backend and reveals no order data", async () => {
    const response = await GET(
      new Request(
        "http://deskohub.test/api/v1/mobile/payment-return/private-order?locale=en-US"
      ),
      { params: Promise.resolve({ orderId: "private-order" }) }
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toContain("return to the Deskohub Workspace app");
    expect(body).not.toContain("private-order");
    expect(response.headers.get("location")).toBeNull();
  });

  test("uses server-selected localized copy and ignores arbitrary return targets", async () => {
    const response = await GET(
      new Request(
        "http://deskohub.test/api/v1/mobile/payment-return/order-1?locale=cs-CZ&returnTo=https://evil.example"
      ),
      { params: Promise.resolve({ orderId: "order-1" }) }
    );
    const body = await response.text();

    expect(body).toContain("vrátit se do aplikace Deskohub Workspace");
    expect(body).not.toContain("evil.example");
    expect(body).toContain('<html lang="cs-CZ">');
  });
});
