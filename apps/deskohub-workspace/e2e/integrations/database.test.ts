import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { WorkspaceE2EConfig } from "../config";
import { defaultWorkspaceE2ETimeouts } from "../timeouts";
import type { CheckoutRow } from "../types";
import { replayNexiWebhook } from "./database";

test("reads persisted reservation details without legacy product columns", async () => {
  const source = await Bun.file(
    fileURLToPath(new URL("./database.ts", import.meta.url))
  ).text();

  expect(source).toContain("wr.reservation_details");
  expect(source).not.toContain("wr.product_tier");
  expect(source).not.toContain("wr.product_coffee");
  expect(source).not.toContain("wr.product_monitor_option");
});

test("replays Nexi notification against the exact protected preview", async () => {
  const requests: Array<{
    body: string;
    headers: Headers;
    method: string | undefined;
    url: string;
  }> = [];
  const fetchMock = mock(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push({
        body: await request.clone().text(),
        headers: request.headers,
        method: request.method,
        url: request.url,
      });
      return new Response(null, { status: 200 });
    }
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  await Effect.runPromise(
    replayNexiWebhook(makeConfig(), makeCheckoutRow()).pipe(
      Effect.provide(httpClientLayer)
    )
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
  timeouts: defaultWorkspaceE2ETimeouts,
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
