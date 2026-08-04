import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Exit, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutRow } from "../types";
import {
  assertDiscountApplications,
  assertInternalDiscountApplications,
  replayNexiWebhook,
} from "./database";

test("reads persisted reservation details without legacy product columns", async () => {
  const source = await Bun.file(
    fileURLToPath(new URL("./database.ts", import.meta.url))
  ).text();

  expect(source).toContain(
    "reservation_details: workspaceReservations.reservationDetails"
  );
  expect(source).not.toContain("workspaceReservations.productTier");
  expect(source).not.toContain("workspaceReservations.productCoffee");
  expect(source).not.toContain("workspaceReservations.productMonitorOption");
});

test("uses one scoped Drizzle client for the exact preview datasource", async () => {
  const databaseServiceSource = await Bun.file(
    fileURLToPath(new URL("./database.service.ts", import.meta.url))
  ).text();
  const runnerSource = await Bun.file(
    fileURLToPath(new URL("../services/runner.ts", import.meta.url))
  ).text();

  expect(databaseServiceSource).toContain(
    "connectionString: config.databaseUrlUnpooled"
  );
  expect(databaseServiceSource).not.toContain(
    "connectionString: config.databaseUrl,"
  );
  expect(runnerSource).toContain(
    "Effect.provide(E2EDatabase.layer(datasourceConfig))"
  );
});

test("polls for checkout rows before asserting reservation replacement state", async () => {
  const databaseSource = await Bun.file(
    fileURLToPath(new URL("./database.ts", import.meta.url))
  ).text();
  const reservationReplacementSource = await Bun.file(
    fileURLToPath(new URL("../cases/reservation-reuse.ts", import.meta.url))
  ).text();

  expect(databaseSource).toContain(
    "pollUntil(readCheckoutRowFromDatabase(db, orderId)"
  );
  expect(reservationReplacementSource).toContain(
    "waitForCheckoutRow(datasourceConfig, orderId)"
  );
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

test.each([
  ["nexi_webhook_fulfillment_failed", "nexi_webhook_fulfillment_failed"],
  ["provider-payload-value", undefined],
] as const)("keeps webhook failure diagnostics on the fixed allowlist for %s", async (responseCode, expectedDiagnosticCode) => {
  const fetchMock = mock(async () =>
    Response.json(
      { code: responseCode, payload: "provider payload must stay private" },
      { status: 500 }
    )
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  const exit = await Effect.runPromiseExit(
    replayNexiWebhook(makeConfig(), makeCheckoutRow()).pipe(
      Effect.provide(httpClientLayer)
    )
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) return;
  const error = Cause.squash(exit.cause);
  expect(error).toMatchObject({
    message: "Nexi webhook replay failed with 500",
  });
  expect((error as { readonly diagnosticCode?: unknown }).diagnosticCode).toBe(
    expectedDiagnosticCode
  );
  expect(JSON.stringify(error)).not.toContain(
    "provider payload must stay private"
  );
});

test("accepts automatic discounts stacked before the redeemed zero-total code", () => {
  expect(() =>
    assertInternalDiscountApplications([
      {
        applied_amount_value: 100,
        redemption_state: null,
        redeemed_at: null,
        subtotal_after_value: 900,
        subtotal_before_value: 1000,
      },
      {
        applied_amount_value: 900,
        redemption_state: "redeemed",
        redeemed_at: new Date("2099-07-24T12:00:00.000Z"),
        subtotal_after_value: 0,
        subtotal_before_value: 900,
      },
    ])
  ).not.toThrow();
});

test("accepts the catalog money exponent in persisted discount applications", () => {
  expect(() =>
    assertDiscountApplications(
      [
        {
          adjustment: { kind: "percentage", basisPoints: 1000 },
          applied_amount_currency: "CZK",
          applied_amount_exponent: 2,
          applied_amount_value: 3500,
          countdown_starts_at: null,
          expires_at: null,
          label: "Customer discount",
          redeemed_at: null,
          redemption_state: null,
          sequence: 0,
          subtotal_after_currency: "CZK",
          subtotal_after_exponent: 2,
          subtotal_after_value: 31_500,
          subtotal_before_currency: "CZK",
          subtotal_before_exponent: 2,
          subtotal_before_value: 35_000,
        },
      ],
      [{ basisPoints: 1000, label: "Customer discount" }],
      "CZK"
    )
  ).not.toThrow();
});

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: "test-protection-bypass",
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
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
