import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutRow } from "../types";
import {
  assertDiscountApplications,
  assertInternalDiscountApplications,
  assertLatePaymentRecoveryOutcome,
  assertLegalEvidenceRows,
  getProviderSessionRowDiagnosticCode,
  replayNexiWebhook,
  waitForProviderSessionRowAfterRedirect,
} from "./database";

test("accepts a recreated late-payment recovery", async () => {
  await Effect.runPromise(
    assertLatePaymentRecoveryOutcome(
      {
        checkoutRow: {
          dotypos_reservation_id: "replacement-reservation",
          failure_code: null,
          fulfillment_state: "processing",
          payment_attempt_state: "paid",
          payment_state: "paid",
          reservation_state: "confirmed",
          webhook_state: "processed",
        } as CheckoutRow,
        recovery: {
          completedAt: {} as never,
          failureCode: null,
          originalDotyposReservationId: "original-reservation",
          recoveredDotyposReservationId: "replacement-reservation",
          state: "recovered",
        } as never,
      },
      "original-reservation" as never,
      { state: "recovered" }
    )
  );
});

test("accepts a refund-required late-payment recovery", async () => {
  await Effect.runPromise(
    assertLatePaymentRecoveryOutcome(
      {
        checkoutRow: {
          dotypos_reservation_id: "original-reservation",
          failure_code: "late_payment_snapshot_unavailable",
          fulfillment_state: "not_started",
          payment_attempt_state: "paid",
          payment_state: "paid",
          reservation_state: "cancelled",
          webhook_state: "processed",
        } as CheckoutRow,
        recovery: {
          completedAt: {} as never,
          failureCode: "late_payment_snapshot_unavailable",
          originalDotyposReservationId: "original-reservation",
          recoveredDotyposReservationId: null,
          state: "refund_required",
        } as never,
      },
      "original-reservation" as never,
      {
        state: "refund_required",
        failureCode: "late_payment_snapshot_unavailable",
      }
    )
  );
});

test("accepts reservation terms evidence from payment submission", () => {
  const row = (document_key: string, source: string, accepted = true) => ({
    accepted,
    document_key,
    hash_algorithm: "sha256",
    locale: "en-US",
    source,
  });

  expect(() =>
    assertLegalEvidenceRows(
      [
        row("termsAndConditions", "payment_submit"),
        row("operatingRules", "payment_submit"),
      ],
      "en-US"
    )
  ).not.toThrow();
});

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

test("uses one worker-scoped Drizzle client for the exact preview datasource", async () => {
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
  expect(runnerSource).toContain("E2EDatabase.layer(datasourceConfig)");
  expect(runnerSource).toContain(
    "WorkspaceE2ECaseService.Default.pipe(Layer.provideMerge(support))"
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

test("classifies provider session rows after the hosted redirect barrier", () => {
  expect(getProviderSessionRowDiagnosticCode(undefined)).toBe(
    "provider_session_reservation_missing_after_redirect"
  );
  expect(
    getProviderSessionRowDiagnosticCode({
      reservation_id: "reservation-1",
    } as CheckoutRow)
  ).toBe("provider_session_active_attempt_missing_after_redirect");
  expect(
    getProviderSessionRowDiagnosticCode({
      amount_value: 100,
      currency: "EUR",
      payment_attempt_id: "attempt-1",
      provider_order_id: "provider-order-1",
      reservation_id: "reservation-1",
    } as CheckoutRow)
  ).toBe("provider_session_fields_missing_after_redirect");
  expect(
    getProviderSessionRowDiagnosticCode({
      amount_value: 100,
      currency: "EUR",
      payment_attempt_id: "attempt-1",
      provider_order_id: "provider-order-1",
      provider_redirect_url: "https://provider.example/hosted",
      reservation_id: "reservation-1",
      security_token: "",
    } as CheckoutRow)
  ).toBe("provider_session_fields_missing_after_redirect");
  expect(
    getProviderSessionRowDiagnosticCode({
      amount_value: 100,
      currency: "EUR",
      payment_attempt_id: "attempt-1",
      provider_order_id: "provider-order-1",
      provider_redirect_url: "https://provider.example/hosted",
      reservation_id: "reservation-1",
      security_token: "security-token",
    } as CheckoutRow)
  ).toBeUndefined();
});

test("waits briefly for the provider session row to converge after redirect", async () => {
  const completeRow = {
    amount_value: 100,
    currency: "EUR",
    payment_attempt_id: "attempt-1",
    provider_order_id: "provider-order-1",
    provider_redirect_url: "https://provider.example/hosted",
    reservation_id: "reservation-1",
    security_token: "security-token",
  } as CheckoutRow;
  const rows: readonly (CheckoutRow | undefined)[] = [
    undefined,
    { reservation_id: "reservation-1" } as CheckoutRow,
    completeRow,
  ];
  const observedRows: CheckoutRow[] = [];
  let reads = 0;

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const waited = yield* Effect.forkChild(
        waitForProviderSessionRowAfterRedirect(
          Effect.sync(() => rows[reads++]),
          {
            intervalMs: 1,
            onRow: (row) => observedRows.push(row),
            timeoutMs: 2_000,
          }
        )
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1 millis");
      yield* TestClock.adjust("1 millis");
      return yield* Fiber.join(waited);
    }).pipe(Effect.provide(TestClock.layer()))
  );

  expect(result).toBe(completeRow);
  expect(reads).toBe(3);
  expect(observedRows).toEqual([rows[1], completeRow]);
});

test("retains the last provider session diagnostic after convergence times out", async () => {
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const waited = yield* Effect.forkChild(
        waitForProviderSessionRowAfterRedirect(
          Effect.succeed({ reservation_id: "reservation-1" } as CheckoutRow),
          { intervalMs: 1, timeoutMs: 5 }
        )
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("5 millis");
      return yield* Fiber.join(waited);
    }).pipe(Effect.provide(TestClock.layer()))
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) return;
  expect(Cause.squash(exit.cause)).toMatchObject({
    diagnosticCode: "provider_session_active_attempt_missing_after_redirect",
    reason: "timeout",
  });
});

test("assigns fixed diagnostics to the Postgres validation boundaries", async () => {
  const source = await Bun.file(
    fileURLToPath(new URL("./database.ts", import.meta.url))
  ).text();

  for (const diagnosticCode of [
    "postgres_checkout_row_convergence_failed",
    "postgres_checkout_row_assertion_failed",
    "postgres_legal_evidence_validation_failed",
    "postgres_local_pii_validation_failed",
  ]) {
    expect(source).toMatch(
      new RegExp(
        `withWorkspaceE2EDiagnosticCode\\(\\s*"${diagnosticCode}"\\s*\\)`
      )
    );
  }
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
  ["postgres_checkout_row_assertion_failed", undefined],
  ["provider-payload-value", undefined],
] as const)(
  "keeps webhook failure diagnostics on the fixed allowlist for %s",
  async (responseCode, expectedDiagnosticCode) => {
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
    expect(
      (error as { readonly diagnosticCode?: unknown }).diagnosticCode
    ).toBe(expectedDiagnosticCode);
    expect(JSON.stringify(error)).not.toContain(
      "provider payload must stay private"
    );
  }
);

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
      [
        {
          adjustment: { kind: "percentage", basisPoints: 1000 },
          label: "Customer discount",
        },
      ],
      "CZK"
    )
  ).not.toThrow();
});

test("accepts a fixed voucher that leaves a positive payment balance", () => {
  expect(() =>
    assertDiscountApplications(
      [
        {
          adjustment: {
            kind: "fixed",
            amount: { value: 10_000, exponent: 2, currency: "CZK" },
          },
          applied_amount_currency: "CZK",
          applied_amount_exponent: 2,
          applied_amount_value: 10_000,
          countdown_starts_at: null,
          expires_at: null,
          label: "Voucher",
          redeemed_at: new Date("2099-07-24T12:00:00.000Z"),
          redemption_state: "redeemed",
          sequence: 0,
          subtotal_after_currency: "CZK",
          subtotal_after_exponent: 2,
          subtotal_after_value: 18_000,
          subtotal_before_currency: "CZK",
          subtotal_before_exponent: 2,
          subtotal_before_value: 28_000,
        },
      ],
      [
        {
          adjustment: {
            kind: "fixed",
            amount: { value: 10_000, exponent: 2, currency: "CZK" },
          },
          label: "Voucher",
          redemptionState: "redeemed",
        },
      ],
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
