import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { deepStrictEqual } from "node:assert/strict";
import { Pool, type QueryResultRow } from "pg";
import { normalizePostgresConnectionUrl } from "../../db/postgres-connection-url";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { pollUntil } from "../polling";
import { assert, log } from "../runtime";
import {
  getWorkspaceE2ETimeoutMs,
  workspaceE2EPollIntervalMs,
} from "../timeouts";
import type {
  CheckoutData,
  CheckoutRow,
  PaymentTerminalScenario,
} from "../types";
import { makeUrl } from "../urls";

export const waitForWebhookReplayRow = (
  config: DatasourceConfig,
  orderId: string,
  onRow?: (row: CheckoutRow) => void
): Effect.Effect<CheckoutRow, WorkspaceE2EError> =>
  withPool(config, (pool) =>
    pollUntil(
      queryCheckoutRow(pool, orderId).pipe(
        Effect.tap((row) =>
          row ? Effect.sync(() => onRow?.(row)) : Effect.void
        ),
        Effect.map((row) =>
          row && isWebhookReplayReady(row) ? row : undefined
        )
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: `webhook replay checkout row for ${orderId}`,
        timeoutMs: getWorkspaceE2ETimeoutMs("datasource"),
      }
    )
  );

const isWebhookReplayReady = (row: CheckoutRow) =>
  !!row.provider_order_id &&
  !!row.security_token &&
  !!row.amount_value &&
  !!row.currency &&
  !!row.payment_attempt_id;

export const replayNexiWebhook = (
  config: WorkspaceE2EConfig,
  row: CheckoutRow
): Effect.Effect<void, WorkspaceE2EError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    yield* tryWorkspaceE2ESync("assert Nexi replay row", () => {
      assert(row.provider_order_id, "provider order id missing before replay");
      assert(row.security_token, "security token missing before replay");
      assert(row.amount_value, "amount missing before replay");
      assert(row.currency, "currency missing before replay");
    });

    const webhookUrl = yield* makeUrl(
      "build Nexi webhook replay URL",
      "/api/webhooks/nexi",
      config.baseUrl
    );
    const httpClient = yield* HttpClient.HttpClient;
    const response = yield* HttpClientRequest.post(webhookUrl).pipe(
      HttpClientRequest.setHeaders(previewWebhookHeaders(config)),
      HttpClientRequest.bodyJson({
        eventId: `workspace-e2e-nexi-${row.reservation_id}`,
        eventTime: new Date().toISOString(),
        securityToken: row.security_token,
        operation: {
          orderId: row.provider_order_id,
          operationId:
            row.last_provider_operation_id ??
            `workspace-e2e-${row.reservation_id}`,
          operationType: "CAPTURE",
          operationResult: "EXECUTED",
          operationTime: new Date().toISOString(),
          operationAmount: String(row.amount_value),
          operationCurrency: row.currency,
        },
      }),
      Effect.flatMap(httpClient.execute),
      Effect.mapError((cause) =>
        toWorkspaceE2EError("replay Nexi webhook", cause)
      )
    );
    yield* Effect.succeed(response).pipe(
      Effect.filterOrFail(
        ({ status }) => status >= 200 && status < 300,
        ({ status }) =>
          workspaceE2EError(`Nexi webhook replay failed with ${status}`, {
            operation: "replay Nexi webhook",
          })
      )
    );
    log("Nexi webhook replay accepted");
  });

const previewWebhookHeaders = (config: WorkspaceE2EConfig) => ({
  "content-type": "application/json",
  ...(config.bypassSecret
    ? { "x-vercel-protection-bypass": config.bypassSecret }
    : {}),
});

export const validatePostgres = (
  config: DatasourceConfig,
  data: CheckoutData,
  orderId: string,
  onRow?: (row: CheckoutRow) => void
): Effect.Effect<CheckoutRow, WorkspaceE2EError> =>
  withPool(config, (pool) =>
    Effect.gen(function* () {
      const row = yield* pollUntil(
        queryCheckoutRow(pool, orderId).pipe(
          Effect.tap((row) =>
            row ? Effect.sync(() => onRow?.(row)) : Effect.void
          ),
          Effect.map((row) =>
            row && isPostgresComplete(row, config) ? row : undefined
          )
        ),
        {
          intervalMs: workspaceE2EPollIntervalMs.datasource,
          label: `Postgres checkout rows for ${orderId}`,
          timeoutMs: getWorkspaceE2ETimeoutMs("datasource"),
        }
      );

      yield* assertPostgresRow(row, data, config);
      yield* assertLegalEvidence(pool, orderId, data.locale);
      yield* assertNoLocalPii(
        pool,
        orderId,
        row.payment_attempt_id,
        row.webhook_id,
        data
      );
      log("Postgres checkout tables validated");
      return row;
    })
  );

const queryCheckoutRow = (
  pool: Pool,
  orderId: string
): Effect.Effect<CheckoutRow | undefined, WorkspaceE2EError> =>
  query<CheckoutRow>(
    pool,
    "read checkout row",
    `select
      wr.id as reservation_id,
      wr.checkout_session_key,
      wr.checkout_attempt_key,
      wr.correlation_id,
      wr.dotypos_customer_id,
      wr.dotypos_reservation_id,
      wr.reservation_state,
      wr.payment_state,
      wr.fulfillment_state,
      wr.active_payment_attempt_id,
      wr.reservation_details,
      wr.locale,
      wr.reservation_created_at,
      wr.reservation_hold_expires_at,
      wr.reservation_confirmed_at,
      wr.reservation_cancelled_at,
      wr.reservation_hold_expired_at,
      wr.paid_at,
      wr.fulfilled_at,
      wr.fulfillment_failed_at,
      wr.failure_code,
      wr.fulfillment_failure_code,
      pa.id as payment_attempt_id,
      pa.provider,
      pa.provider_order_id,
      pa.security_token,
      pa.state as payment_attempt_state,
      pa.amount_value,
      pa.amount_exponent,
      pa.currency,
      pa.provider_redirect_url,
      pa.last_webhook_event_id,
      pa.last_provider_operation_id,
      pa.last_provider_status,
      pa.failure_code as payment_failure_code,
      wh.id as webhook_id,
      wh.provider as webhook_provider,
      wh.event_id as webhook_event_id,
      wh.provider_order_id as webhook_provider_order_id,
      wh.processed_at as webhook_processed_at,
      wh.state as webhook_state,
      wh.error_code as webhook_error_code
    from workspace_reservations wr
    left join payment_attempts pa on pa.id = wr.active_payment_attempt_id
    left join webhook_events wh on wh.event_id = pa.last_webhook_event_id
    where wr.id = $1`,
    [orderId]
  ).pipe(Effect.map((result) => result.rows[0]));

export const readCheckoutRow = (
  config: DatasourceConfig,
  orderId: string
): Effect.Effect<CheckoutRow | undefined, WorkspaceE2EError> =>
  withPool(config, (pool) => queryCheckoutRow(pool, orderId));

export const readLatestCleanupCheckoutRow = (
  config: DatasourceConfig,
  createdAfter: Date,
  data: CheckoutData
): Effect.Effect<CheckoutRow | undefined, WorkspaceE2EError> =>
  withPool(config, (pool) =>
    Effect.gen(function* () {
      const result = yield* query<{ id: string }>(
        pool,
        "read latest checkout cleanup row",
        `select wr.id
      from workspace_reservations wr
      where wr.reservation_created_at >= $1
        and wr.dotypos_reservation_id is not null
        and wr.payment_state <> 'paid'
        and wr.reservation_details = $2::jsonb
        and wr.locale = $3
      order by wr.reservation_created_at desc
      limit 1`,
        [
          createdAfter,
          JSON.stringify(data.expectedReservationDetails),
          data.locale,
        ]
      );

      const orderId = result.rows[0]?.id;
      return orderId ? yield* queryCheckoutRow(pool, orderId) : undefined;
    })
  );

export const markPaymentTerminalForE2E = (
  config: DatasourceConfig,
  orderId: string,
  scenario: PaymentTerminalScenario
): Effect.Effect<CheckoutRow, WorkspaceE2EError> =>
  withPool(config, (pool) =>
    Effect.gen(function* () {
      const current = yield* queryCheckoutRow(pool, orderId);
      const paymentAttemptId = yield* tryWorkspaceE2ESync(
        "assert payment terminal checkout row",
        () => {
          assert(current?.payment_attempt_id, "payment attempt missing");
          return current.payment_attempt_id;
        }
      );

      const failureCode = `workspace_e2e_nexi_${scenario.state}`;
      const providerOperationId = `workspace-e2e-${scenario.state}-${orderId}`;

      yield* query(
        pool,
        "mark payment attempt terminal state",
        `update payment_attempts
      set state = $3,
        failure_code = $4,
        last_provider_operation_id = $5,
        last_provider_status = $6,
        updated_at = now()
      where id = $1
        and workspace_reservation_id = $2
        and state in ('created', 'pending', $3)`,
        [
          paymentAttemptId,
          orderId,
          scenario.state,
          failureCode,
          providerOperationId,
          scenario.providerStatus,
        ]
      );

      yield* query(
        pool,
        "mark reservation terminal payment state",
        `update workspace_reservations
      set payment_state = $3,
        failure_code = $4,
        updated_at = now()
      where id = $1
        and active_payment_attempt_id = $2
        and reservation_state = 'held'
        and payment_state in ('pending', $3)`,
        [orderId, paymentAttemptId, scenario.state, failureCode]
      );

      const row = yield* queryCheckoutRow(pool, orderId);
      return yield* tryWorkspaceE2ESync(
        "assert terminal checkout row exists",
        () => {
          assert(row, "terminal checkout row missing");
          return row;
        }
      );
    })
  );

export const markFulfillmentFailedForE2E = (
  config: DatasourceConfig,
  orderId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  withPool(config, (pool) =>
    Effect.gen(function* () {
      const result = yield* query<{ id: string }>(
        pool,
        "mark checkout fulfillment failed",
        `update workspace_reservations
      set fulfillment_state = 'failed',
        fulfilled_at = null,
        fulfillment_failed_at = now(),
        fulfillment_failure_code = 'workspace_e2e_delivery_failed',
        updated_at = now()
      where id = $1
        and payment_state = 'paid'
        and fulfillment_state = 'fulfilled'
      returning id`,
        [orderId]
      );

      yield* tryWorkspaceE2ESync("assert fulfillment failed marker", () =>
        assert(
          result.rows[0]?.id === orderId,
          "fulfilled checkout row could not be marked fulfillment_failed"
        )
      );
    })
  );

export const markConsoleFulfillmentDeliveredForE2E = (
  config: DatasourceConfig,
  orderId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  withPool(config, (pool) =>
    Effect.gen(function* () {
      const row = yield* pollUntil(
        Effect.gen(function* () {
          const result = yield* query<{ id: string }>(
            pool,
            "mark console fulfillment delivered",
            `update workspace_reservations
          set fulfillment_state = 'fulfilled',
            fulfilled_at = coalesce(fulfilled_at, now()),
            updated_at = now()
          where id = $1
            and payment_state = 'paid'
            and fulfillment_state = 'processing'
            and reservation_confirmed_at is not null
            and dotypos_reservation_id is not null
          returning id`,
            [orderId]
          );

          if (result.rows[0]?.id !== orderId) {
            const current = yield* queryCheckoutRow(pool, orderId);
            return current?.fulfillment_state === "fulfilled"
              ? current
              : undefined;
          }

          return yield* queryCheckoutRow(pool, orderId);
        }),
        {
          intervalMs: workspaceE2EPollIntervalMs.datasource,
          label: `console fulfillment marker for ${orderId}`,
          timeoutMs: getWorkspaceE2ETimeoutMs("datasource"),
        }
      );

      yield* tryWorkspaceE2ESync("assert console fulfillment marker row", () =>
        assert(row, "console fulfillment marker row missing")
      );
      log("Console fulfillment delivery marker applied");
    })
  );

const isPostgresComplete = (row: CheckoutRow, config: DatasourceConfig) =>
  row.reservation_state === "confirmed" &&
  row.payment_state === "paid" &&
  row.fulfillment_state === "fulfilled" &&
  row.payment_attempt_state === "paid" &&
  row.currency === config.expectedCurrency &&
  row.webhook_state === "processed";

export const assertPaymentTerminalRow = (
  row: CheckoutRow,
  scenario: PaymentTerminalScenario
): Effect.Effect<void, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("assert payment terminal row", () => {
    assert(
      row.payment_state === scenario.state,
      `reservation payment state was not ${scenario.state}`
    );
    assert(
      row.payment_attempt_state === scenario.state,
      `payment attempt state was not ${scenario.state}`
    );
    assert(
      row.payment_failure_code === `workspace_e2e_nexi_${scenario.state}`,
      "terminal payment failure code mismatch"
    );
    assert(
      row.last_provider_status === scenario.providerStatus,
      "terminal payment provider status mismatch"
    );
    assert(
      row.fulfillment_state === "not_started",
      "terminal payment should not start fulfillment"
    );
  });

const assertPostgresRow = (
  row: CheckoutRow,
  data: CheckoutData,
  config: DatasourceConfig
): Effect.Effect<void, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("assert Postgres checkout row", () => {
    assert(
      row.reservation_id === data.orderIdHint || row.reservation_id,
      "reservation id missing"
    );
    assert(
      row.reservation_state === "confirmed",
      "reservation was not confirmed"
    );
    assert(row.payment_state === "paid", "reservation payment was not paid");
    assert(
      row.fulfillment_state === "fulfilled",
      "reservation fulfillment was not fulfilled"
    );
    assert(row.active_payment_attempt_id, "active payment attempt missing");
    assert(row.dotypos_customer_id, "Dotypos customer id missing");
    assert(row.dotypos_reservation_id, "Dotypos reservation id missing");
    assert(row.reservation_created_at, "reservation_created_at missing");
    assert(row.reservation_confirmed_at, "reservation_confirmed_at missing");
    assert(row.paid_at, "paid_at missing");
    assert(row.fulfilled_at, "fulfilled_at missing");
    assert(
      row.reservation_cancelled_at === null,
      "reservation_cancelled_at should be null"
    );
    assert(
      row.reservation_hold_expired_at === null,
      "reservation_hold_expired_at should be null"
    );
    assert(
      row.fulfillment_failed_at === null,
      "fulfillment_failed_at should be null"
    );
    assert(
      row.failure_code === null,
      "reservation failure_code should be null"
    );
    assert(
      row.fulfillment_failure_code === null,
      "fulfillment_failure_code should be null"
    );
    deepStrictEqual(
      row.reservation_details,
      data.expectedReservationDetails,
      "unexpected reservation details"
    );
    assert(row.locale === data.locale, "unexpected locale");
    assert(
      row.payment_attempt_id === row.active_payment_attempt_id,
      "active attempt mismatch"
    );
    assert(row.provider === "nexi", "payment provider should be nexi");
    assert(row.provider_order_id, "provider order id missing");
    assert(row.security_token, "security token missing");
    assert(
      row.payment_attempt_state === "paid",
      "payment attempt was not paid"
    );
    assert(row.amount_value && row.amount_value > 0, "payment amount missing");
    assert(row.amount_exponent !== null, "payment amount exponent missing");
    assert(
      row.currency === config.expectedCurrency,
      `expected ${config.expectedCurrency} currency`
    );
    assert(row.provider_redirect_url, "provider redirect URL missing");
    assert(row.last_webhook_event_id, "last webhook event id missing");
    assert(
      row.last_provider_operation_id,
      "last provider operation id missing"
    );
    assert(
      row.last_provider_status === "EXECUTED",
      "last provider status was not EXECUTED"
    );
    assert(
      row.payment_failure_code === null,
      "payment failure code should be null"
    );
    assert(row.webhook_id, "webhook id missing");
    assert(
      row.webhook_event_id === row.last_webhook_event_id,
      "webhook event id mismatch"
    );
    assert(row.webhook_provider === "nexi", "webhook provider should be nexi");
    assert(
      row.webhook_provider_order_id === row.provider_order_id,
      "webhook order id mismatch"
    );
    assert(row.webhook_processed_at, "webhook processed_at missing");
    assert(row.webhook_state === "processed", "webhook was not processed");
    assert(
      row.webhook_error_code === null,
      "webhook error code should be null"
    );
  });

const assertLegalEvidence = (
  pool: Pool,
  orderId: string,
  locale: CheckoutData["locale"]
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const result = yield* query<{
      accepted: boolean;
      document_key: string;
      hash_algorithm: string;
      locale: string;
      source: string;
    }>(
      pool,
      "read legal evidence rows",
      `select document_key, source, accepted, hash_algorithm, locale
    from legal_evidence_events
    where workspace_reservation_id = $1`,
      [orderId]
    );

    yield* tryWorkspaceE2ESync("assert legal evidence rows", () => {
      const expected = new Set([
        "privacyPolicy:reservation_submit",
        "termsAndConditions:payment_submit",
        "operatingRules:payment_submit",
      ]);

      for (const row of result.rows) {
        assert(
          row.accepted,
          `legal evidence ${row.document_key} was not accepted`
        );
        assert(
          row.hash_algorithm === "sha256",
          "legal evidence hash algorithm mismatch"
        );
        assert(row.locale === locale, "legal evidence locale mismatch");
        expected.delete(`${row.document_key}:${row.source}`);
      }

      assert(
        expected.size === 0,
        `missing legal evidence rows: ${[...expected].join(", ")}`
      );
    });
  });

const assertNoLocalPii = (
  pool: Pool,
  orderId: string,
  paymentAttemptId: string | null,
  webhookEventId: string | null,
  data: CheckoutData
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const result = yield* query<{ count: string }>(
      pool,
      "scan checkout tables for local PII",
      `with payloads as (
      select to_jsonb(wr)::text as payload
      from workspace_reservations wr
      where wr.id = $1
      union all
      select to_jsonb(pa)::text
      from payment_attempts pa
      where pa.id = $2
      union all
      select to_jsonb(wh)::text
      from webhook_events wh
      where wh.id = $3
      union all
      select to_jsonb(le)::text
      from legal_evidence_events le
      where le.workspace_reservation_id = $1
    )
    select count(*)
      from payloads
      where payload ilike $4 or payload ilike $5 or payload ilike $6 or payload ilike $7`,
      [
        orderId,
        paymentAttemptId,
        webhookEventId,
        `%${data.email}%`,
        `%${data.phone}%`,
        `%${data.name}%`,
        `%${data.message}%`,
      ]
    );

    yield* tryWorkspaceE2ESync(
      "assert checkout tables do not contain local PII",
      () =>
        assert(
          Number(result.rows[0]?.count ?? 0) === 0,
          "local checkout tables contain test PII"
        )
    );
  });

const makePool = (config: DatasourceConfig) =>
  new Pool({
    connectionString: normalizePostgresConnectionUrl(config.databaseUrl),
    connectionTimeoutMillis: getWorkspaceE2ETimeoutMs("datasource"),
    query_timeout: getWorkspaceE2ETimeoutMs("datasource"),
    statement_timeout: getWorkspaceE2ETimeoutMs("datasource"),
  });

const withPool = <A>(
  config: DatasourceConfig,
  use: (pool: Pool) => Effect.Effect<A, WorkspaceE2EError>
): Effect.Effect<A, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("create Postgres pool", () => makePool(config)).pipe(
    Effect.flatMap((pool) =>
      use(pool).pipe(
        Effect.ensuring(
          tryWorkspaceE2EPromise("close Postgres pool", () => pool.end()).pipe(
            Effect.ignore
          )
        )
      )
    )
  );

const query = <T extends QueryResultRow>(
  pool: Pool,
  operation: string,
  text: string,
  values: readonly unknown[] = []
) => tryWorkspaceE2EPromise(operation, () => pool.query<T>(text, [...values]));
