import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { CheckoutRow } from "../types";
import { replayNexiWebhook } from "./database";

test("replays Nexi notification against the exact protected preview", async () => {
  const requests: Array<{
    body: string;
    headers: Headers;
    method: string | undefined;
    url: string;
  }> = [];
  const fetch_ = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push({
      body: String(init?.body),
      headers: new Headers(init?.headers),
      method: init?.method,
      url: String(input),
    });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  await Effect.runPromise(
    replayNexiWebhook(makeConfig(), makeCheckoutRow(), fetch_)
  );

  expect(requests).toHaveLength(1);
  const request = requests[0];
  expect(request?.url).toBe(
    "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/api/webhooks/nexi"
  );
  expect(request?.method).toBe("POST");
  expect(request?.headers.get("content-type")).toBe("application/json");
  expect(request?.headers.get("x-vercel-protection-bypass")).toBe(
    "test-protection-bypass"
  );
  expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
    operation: {
      operationCurrency: "EUR",
      operationResult: "EXECUTED",
      orderId: "provider-order-1",
    },
    securityToken: "test-security-token",
  });
});

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: "test-protection-bypass",
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
});

const makeCheckoutRow = () =>
  ({
    amount_value: 100,
    currency: "EUR",
    last_provider_operation_id: "provider-operation-1",
    provider_order_id: "provider-order-1",
    reservation_id: "reservation-1",
    security_token: "test-security-token",
  }) as CheckoutRow;
