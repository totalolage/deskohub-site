import { deepStrictEqual } from "node:assert/strict";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { Effect } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/unstable/http";
import type { DatabaseClient } from "@/db/database-client";
import {
  discountApplications,
  discountCodeRedemptions,
  legalEvidenceEvents,
  paymentAttempts,
  webhookEvents,
  workspaceReservations,
} from "@/db/schema";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import {
  isNexiWebhookDiagnosticCode,
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EDiagnosticCode,
  WorkspaceE2EError,
  withWorkspaceE2EDiagnosticCode,
  workspaceE2EError,
} from "../errors";
import { pollUntil } from "../polling";
import { assert, log } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type {
  CheckoutData,
  CheckoutRow,
  PaymentTerminalScenario,
} from "../types";
import { makeUrl } from "../urls";
import { E2EDatabase } from "./database.service";
import {
  runDatabaseOperation,
  runRetrySafeDatabaseOperation,
} from "./database-operation";

export const requireProviderSessionRowAfterRedirect = (
  orderId: string,
  options: {
    readonly onRow?: (row: CheckoutRow) => void;
    readonly timeoutMs: number;
  }
): Effect.Effect<ProviderSessionRow, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    return yield* waitForProviderSessionRowAfterRedirect(
      readCheckoutRowFromDatabase(db, orderId).pipe(
        withWorkspaceE2EDiagnosticCode(
          "provider_session_row_read_failed_after_redirect"
        )
      ),
      {
        ...options,
        intervalMs: workspaceE2EPollIntervalMs.datasource,
      }
    );
  });

export const waitForProviderSessionRowAfterRedirect = (
  readRow: Effect.Effect<CheckoutRow | undefined, WorkspaceE2EError>,
  options: {
    readonly intervalMs: number;
    readonly onRow?: (row: CheckoutRow) => void;
    readonly timeoutMs: number;
  }
): Effect.Effect<ProviderSessionRow, WorkspaceE2EError> => {
  let lastRow: CheckoutRow | undefined;
  return pollUntil(
    readRow.pipe(
      Effect.tap((row) =>
        row
          ? Effect.sync(() => {
              lastRow = row;
              options.onRow?.(row);
            })
          : Effect.void
      ),
      Effect.map((row) => (isProviderSessionRow(row) ? row : undefined))
    ),
    {
      intervalMs: options.intervalMs,
      label: "provider session row after hosted redirect",
      timeoutMs: options.timeoutMs,
    }
  ).pipe(
    Effect.mapError((error) =>
      error.diagnosticCode
        ? error
        : new WorkspaceE2EError({
            cause: error,
            diagnosticCode:
              getProviderSessionRowDiagnosticCode(lastRow) ??
              "provider_session_reservation_missing_after_redirect",
            message:
              "Provider session row did not satisfy the hosted redirect persistence invariant.",
            operation: "read provider session row after hosted redirect",
            reason: error.reason,
          })
    )
  );
};

export const getProviderSessionRowDiagnosticCode = (
  row: CheckoutRow | undefined
): WorkspaceE2EDiagnosticCode | undefined => {
  if (!row) return "provider_session_reservation_missing_after_redirect";
  if (!row.payment_attempt_id) {
    return "provider_session_active_attempt_missing_after_redirect";
  }
  if (
    !row.provider_order_id ||
    !row.security_token ||
    row.amount_value === null ||
    !row.currency ||
    !row.provider_redirect_url
  ) {
    return "provider_session_fields_missing_after_redirect";
  }
  return undefined;
};

type ProviderSessionRow = CheckoutRow & {
  readonly amount_value: number;
  readonly currency: string;
  readonly payment_attempt_id: string;
  readonly provider_order_id: string;
  readonly provider_redirect_url: string;
  readonly security_token: string;
};

const isProviderSessionRow = (
  row: CheckoutRow | undefined
): row is ProviderSessionRow =>
  row !== undefined && getProviderSessionRowDiagnosticCode(row) === undefined;

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
    if (response.status < 200 || response.status >= 300) {
      const diagnosticCode = yield* readNexiWebhookDiagnosticCode(response);
      return yield* workspaceE2EError(
        `Nexi webhook replay failed with ${response.status}`,
        {
          ...(diagnosticCode ? { diagnosticCode } : {}),
          operation: "replay Nexi webhook",
        }
      );
    }
    log("Nexi webhook replay accepted");
  });

const readNexiWebhookDiagnosticCode = (
  response: HttpClientResponse.HttpClientResponse
) =>
  response.json.pipe(
    Effect.map((body) => {
      if (!body || typeof body !== "object" || !("code" in body)) {
        return undefined;
      }
      return isNexiWebhookDiagnosticCode(body.code) ? body.code : undefined;
    }),
    Effect.catch(() => Effect.succeed(undefined))
  );

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
): Effect.Effect<CheckoutRow, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const row = yield* pollUntil(
      readCheckoutRowFromDatabase(db, orderId).pipe(
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
        timeoutMs: config.timeouts.datasource,
      }
    ).pipe(
      withWorkspaceE2EDiagnosticCode("postgres_checkout_row_convergence_failed")
    );

    yield* assertPostgresRow(row, data, config).pipe(
      withWorkspaceE2EDiagnosticCode("postgres_checkout_row_assertion_failed")
    );
    yield* assertLegalEvidence(db, orderId, data.locale).pipe(
      withWorkspaceE2EDiagnosticCode(
        "postgres_legal_evidence_validation_failed"
      )
    );
    yield* assertNoLocalPii(
      db,
      orderId,
      row.payment_attempt_id,
      row.webhook_id,
      data
    ).pipe(
      withWorkspaceE2EDiagnosticCode("postgres_local_pii_validation_failed")
    );
    log("Postgres checkout tables validated");
    return row;
  });

export interface ExpectedDiscountApplication {
  readonly basisPoints: number;
  readonly hasExpiration?: boolean;
  readonly label: string;
  readonly redemptionState?: "redeemed";
}

export const validateDiscountApplications = (
  config: DatasourceConfig,
  orderId: string,
  expected: readonly ExpectedDiscountApplication[]
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runRetrySafeDatabaseOperation(
      "read checkout discount applications",
      db
        .select({
          sequence: discountApplications.sequence,
          label: discountApplications.label,
          adjustment: sql<
            DiscountApplicationRow["adjustment"]
          >`${discountApplications.adjustment}`,
          subtotal_before_value: discountApplications.subtotalBeforeValue,
          subtotal_before_exponent: discountApplications.subtotalBeforeExponent,
          subtotal_before_currency: discountApplications.subtotalBeforeCurrency,
          applied_amount_value: discountApplications.appliedAmountValue,
          applied_amount_exponent: discountApplications.appliedAmountExponent,
          applied_amount_currency: discountApplications.appliedAmountCurrency,
          subtotal_after_value: discountApplications.subtotalAfterValue,
          subtotal_after_exponent: discountApplications.subtotalAfterExponent,
          subtotal_after_currency: discountApplications.subtotalAfterCurrency,
          expires_at: discountApplications.expiresAt,
          countdown_starts_at: discountApplications.countdownStartsAt,
          redemption_state: discountCodeRedemptions.state,
          redeemed_at: discountCodeRedemptions.redeemedAt,
        })
        .from(discountApplications)
        .leftJoin(
          discountCodeRedemptions,
          eq(discountCodeRedemptions.applicationId, discountApplications.id)
        )
        .where(eq(discountApplications.workspaceReservationId, orderId))
        .orderBy(asc(discountApplications.sequence))
    );

    yield* tryWorkspaceE2ESync("assert checkout discount applications", () =>
      assertDiscountApplications(rows, expected, config.expectedCurrency)
    );
    log("Discount applications validated");
  });

export interface DiscountApplicationRow {
  readonly adjustment: {
    readonly basisPoints?: number;
    readonly kind?: string;
  };
  readonly applied_amount_currency: string;
  readonly applied_amount_exponent: number;
  readonly applied_amount_value: number;
  readonly countdown_starts_at: Date | Temporal.Instant | null;
  readonly expires_at: Date | Temporal.Instant | null;
  readonly label: string;
  readonly redeemed_at: Date | Temporal.Instant | null;
  readonly redemption_state: string | null;
  readonly sequence: number;
  readonly subtotal_after_currency: string;
  readonly subtotal_after_exponent: number;
  readonly subtotal_after_value: number;
  readonly subtotal_before_currency: string;
  readonly subtotal_before_exponent: number;
  readonly subtotal_before_value: number;
}

export const assertDiscountApplications = (
  rows: readonly DiscountApplicationRow[],
  expected: readonly ExpectedDiscountApplication[],
  expectedCurrency: string
) => {
  assert(
    rows.length === expected.length,
    `expected ${expected.length} discount applications`
  );
  expected.forEach((expectation, index) => {
    const row = rows[index];
    assert(row, `discount application ${index} missing`);
    assert(row.sequence === index, `unexpected discount sequence ${index}`);
    assert(
      row.label === expectation.label,
      `unexpected discount label at sequence ${index}`
    );
    assert(
      row.adjustment.kind === "percentage" &&
        row.adjustment.basisPoints === expectation.basisPoints,
      `unexpected discount adjustment at sequence ${index}`
    );
    assert(
      row.applied_amount_value ===
        Math.round(
          (row.subtotal_before_value * expectation.basisPoints) / 10_000
        ),
      `unexpected discount benefit at sequence ${index}`
    );
    assert(
      row.subtotal_before_value - row.applied_amount_value ===
        row.subtotal_after_value,
      `discount money mismatch at sequence ${index}`
    );
    assert(
      row.applied_amount_value > 0,
      `discount amount must be positive at sequence ${index}`
    );
    assert(
      row.subtotal_before_currency === expectedCurrency &&
        row.applied_amount_currency === expectedCurrency &&
        row.subtotal_after_currency === expectedCurrency,
      `unexpected discount currency at sequence ${index}`
    );
    assert(
      row.subtotal_before_exponent === row.applied_amount_exponent &&
        row.applied_amount_exponent === row.subtotal_after_exponent,
      `unexpected discount exponent at sequence ${index}`
    );
    if (index > 0) {
      assert(
        row.subtotal_before_value === rows[index - 1]?.subtotal_after_value,
        `discount subtotal chain broke at sequence ${index}`
      );
    }
    if (expectation.hasExpiration) {
      assert(row.expires_at, `discount expiration ${index} missing`);
      assert(
        row.countdown_starts_at,
        `discount countdown start ${index} missing`
      );
    } else {
      assert(
        row.expires_at === null,
        `unexpected discount expiration at sequence ${index}`
      );
      assert(
        row.countdown_starts_at === null,
        `unexpected discount countdown at sequence ${index}`
      );
    }
    assert(
      row.redemption_state === (expectation.redemptionState ?? null),
      `unexpected discount redemption state at sequence ${index}`
    );
    if (expectation.redemptionState === "redeemed") {
      assert(row.redeemed_at, `discount redemption timestamp ${index} missing`);
    }
  });
};

export const assertNoDiscountPaymentState = (
  orderId: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const [[attempts], [applications], [redemptions]] =
      yield* runRetrySafeDatabaseOperation(
        "read unavailable-code payment state",
        Effect.all(
          [
            db
              .select({ count: count() })
              .from(paymentAttempts)
              .where(eq(paymentAttempts.workspaceReservationId, orderId)),
            db
              .select({ count: count() })
              .from(discountApplications)
              .where(eq(discountApplications.workspaceReservationId, orderId)),
            db
              .select({ count: count() })
              .from(discountCodeRedemptions)
              .innerJoin(
                discountApplications,
                eq(
                  discountApplications.id,
                  discountCodeRedemptions.applicationId
                )
              )
              .where(eq(discountApplications.workspaceReservationId, orderId)),
          ],
          { concurrency: "inherit" }
        )
      );

    yield* tryWorkspaceE2ESync("assert unavailable-code payment state", () => {
      assert(attempts, "unavailable-code attempt count missing");
      assert(applications, "unavailable-code application count missing");
      assert(redemptions, "unavailable-code redemption count missing");
      assert(attempts.count === 0, "unavailable code created payment attempt");
      assert(
        applications.count === 0,
        "unavailable code created discount application"
      );
      assert(
        redemptions.count === 0,
        "unavailable code created discount redemption"
      );
    });
    log("Unavailable discount code created no payment state");
  });

export const validateInternalPostgres = (
  config: DatasourceConfig,
  data: CheckoutData,
  orderId: string,
  onRow?: (row: CheckoutRow) => void
): Effect.Effect<CheckoutRow, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const row = yield* pollUntil(
      readCheckoutRowFromDatabase(db, orderId).pipe(
        Effect.tap((checkoutRow) =>
          checkoutRow ? Effect.sync(() => onRow?.(checkoutRow)) : Effect.void
        ),
        Effect.map((checkoutRow) =>
          checkoutRow && isInternalPostgresComplete(checkoutRow, config)
            ? checkoutRow
            : undefined
        )
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: `internal Postgres checkout rows for ${orderId}`,
        timeoutMs: config.timeouts.datasource,
      }
    );

    yield* assertInternalPostgresRow(row, data, config);
    yield* assertInternalDiscountState(db, row);
    yield* assertLegalEvidence(db, orderId, data.locale);
    yield* assertNoLocalPii(
      db,
      orderId,
      row.payment_attempt_id,
      row.webhook_id,
      data
    );
    log("Internal Postgres checkout tables validated");
    return row;
  });

const checkoutRowSelection = {
  reservation_id: workspaceReservations.id,
  checkout_session_key: workspaceReservations.checkoutSessionKey,
  checkout_attempt_key: workspaceReservations.checkoutAttemptKey,
  correlation_id: workspaceReservations.correlationId,
  dotypos_customer_id: workspaceReservations.dotyposCustomerId,
  dotypos_reservation_id: workspaceReservations.dotyposReservationId,
  reservation_state: workspaceReservations.reservationState,
  payment_state: workspaceReservations.paymentState,
  fulfillment_state: workspaceReservations.fulfillmentState,
  active_payment_attempt_id: workspaceReservations.activePaymentAttemptId,
  reservation_details: workspaceReservations.reservationDetails,
  locale: workspaceReservations.locale,
  reservation_created_at: workspaceReservations.reservationCreatedAt,
  reservation_hold_expires_at: workspaceReservations.reservationHoldExpiresAt,
  reservation_confirmed_at: workspaceReservations.reservationConfirmedAt,
  reservation_cancelled_at: workspaceReservations.reservationCancelledAt,
  reservation_hold_expired_at: workspaceReservations.reservationHoldExpiredAt,
  paid_at: workspaceReservations.paidAt,
  fulfilled_at: workspaceReservations.fulfilledAt,
  fulfillment_failed_at: workspaceReservations.fulfillmentFailedAt,
  failure_code: workspaceReservations.failureCode,
  fulfillment_failure_code: workspaceReservations.fulfillmentFailureCode,
  payment_attempt_id: paymentAttempts.id,
  provider: paymentAttempts.provider,
  provider_order_id: paymentAttempts.providerOrderId,
  security_token: paymentAttempts.securityToken,
  payment_attempt_state: paymentAttempts.state,
  amount_value: paymentAttempts.amountValue,
  amount_exponent: paymentAttempts.amountExponent,
  currency: paymentAttempts.currency,
  provider_redirect_url: paymentAttempts.providerRedirectUrl,
  last_webhook_event_id: paymentAttempts.lastWebhookEventId,
  last_provider_operation_id: paymentAttempts.lastProviderOperationId,
  last_provider_status: paymentAttempts.lastProviderStatus,
  payment_failure_code: paymentAttempts.failureCode,
  webhook_id: webhookEvents.id,
  webhook_provider: webhookEvents.provider,
  webhook_event_id: webhookEvents.eventId,
  webhook_provider_order_id: webhookEvents.providerOrderId,
  webhook_processed_at: webhookEvents.processedAt,
  webhook_state: webhookEvents.state,
  webhook_error_code: webhookEvents.errorCode,
} satisfies Record<keyof CheckoutRow, unknown>;

const readCheckoutRowFromDatabase = (
  db: DatabaseClient,
  orderId: string
): Effect.Effect<CheckoutRow | undefined, WorkspaceE2EError> =>
  runRetrySafeDatabaseOperation(
    "read checkout row",
    db
      .select(checkoutRowSelection)
      .from(workspaceReservations)
      .leftJoin(
        paymentAttempts,
        eq(paymentAttempts.id, workspaceReservations.activePaymentAttemptId)
      )
      .leftJoin(
        webhookEvents,
        eq(webhookEvents.eventId, paymentAttempts.lastWebhookEventId)
      )
      .where(eq(workspaceReservations.id, orderId))
      .limit(1)
  ).pipe(Effect.map((rows) => rows[0]));

export const readCheckoutRow = (
  orderId: string
): Effect.Effect<CheckoutRow | undefined, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    return yield* readCheckoutRowFromDatabase(db, orderId);
  });

export const waitForCheckoutRow = (
  config: DatasourceConfig,
  orderId: string
): Effect.Effect<CheckoutRow, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    return yield* pollUntil(readCheckoutRowFromDatabase(db, orderId), {
      intervalMs: workspaceE2EPollIntervalMs.datasource,
      label: "checkout row",
      timeoutMs: config.timeouts.datasource,
    });
  });

export const readCleanupCheckoutRows = (
  createdAfter: Date,
  data: CheckoutData
): Effect.Effect<readonly CheckoutRow[], WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const reservations = yield* runRetrySafeDatabaseOperation(
      "read checkout cleanup rows",
      db
        .select({ id: workspaceReservations.id })
        .from(workspaceReservations)
        .where(
          and(
            gte(
              workspaceReservations.reservationCreatedAt,
              Temporal.Instant.fromEpochMilliseconds(createdAfter.getTime())
            ),
            isNotNull(workspaceReservations.dotyposReservationId),
            ne(workspaceReservations.paymentState, "paid"),
            eq(
              workspaceReservations.reservationDetails,
              data.expectedReservationDetails
            ),
            eq(workspaceReservations.locale, data.locale)
          )
        )
        .orderBy(desc(workspaceReservations.reservationCreatedAt))
    );

    return yield* Effect.forEach(
      reservations,
      ({ id }) => readCheckoutRowFromDatabase(db, id),
      { concurrency: "inherit" }
    ).pipe(
      Effect.map((rows) =>
        rows.filter((row): row is CheckoutRow => row !== undefined)
      )
    );
  });

export const markPaymentTerminalForE2E = (
  orderId: string,
  paymentAttemptId: string,
  scenario: PaymentTerminalScenario
): Effect.Effect<CheckoutRow, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const failureCode = `workspace_e2e_nexi_${scenario.state}`;
    const providerOperationId = `workspace-e2e-${scenario.state}-${orderId}`;
    const now = Temporal.Now.instant();

    yield* runDatabaseOperation(
      "mark payment attempt terminal state",
      db.transaction((tx) =>
        Effect.gen(function* () {
          yield* tx
            .update(paymentAttempts)
            .set({
              state: scenario.state,
              failureCode,
              lastProviderOperationId: providerOperationId,
              lastProviderStatus: scenario.providerStatus,
              updatedAt: now,
            })
            .where(
              and(
                eq(paymentAttempts.id, paymentAttemptId),
                eq(paymentAttempts.workspaceReservationId, orderId),
                inArray(paymentAttempts.state, [
                  "created",
                  "pending",
                  scenario.state,
                ])
              )
            );

          yield* tx
            .update(workspaceReservations)
            .set({
              paymentState: scenario.state,
              failureCode,
              updatedAt: now,
            })
            .where(
              and(
                eq(workspaceReservations.id, orderId),
                eq(
                  workspaceReservations.activePaymentAttemptId,
                  paymentAttemptId
                ),
                eq(workspaceReservations.reservationState, "held"),
                inArray(workspaceReservations.paymentState, [
                  "pending",
                  scenario.state,
                ])
              )
            );
        })
      )
    );

    const row = yield* readCheckoutRowFromDatabase(db, orderId);
    return yield* tryWorkspaceE2ESync(
      "assert terminal checkout row exists",
      () => {
        assert(row, "terminal checkout row missing");
        return row;
      }
    );
  });

export const markFulfillmentFailedForE2E = (
  orderId: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "mark checkout fulfillment failed",
      db
        .update(workspaceReservations)
        .set({
          fulfillmentState: "failed",
          fulfilledAt: null,
          fulfillmentFailedAt: Temporal.Now.instant(),
          fulfillmentFailureCode: "workspace_e2e_delivery_failed",
          updatedAt: Temporal.Now.instant(),
        })
        .where(
          and(
            eq(workspaceReservations.id, orderId),
            eq(workspaceReservations.paymentState, "paid"),
            eq(workspaceReservations.fulfillmentState, "fulfilled")
          )
        )
        .returning({ id: workspaceReservations.id })
    );

    yield* tryWorkspaceE2ESync("assert fulfillment failed marker", () =>
      assert(
        rows[0]?.id === orderId,
        "fulfilled checkout row could not be marked fulfillment_failed"
      )
    );
  });

export const markPreviewFulfillmentDeliveredForE2E = (
  config: DatasourceConfig,
  orderId: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const row = yield* pollUntil(
      Effect.gen(function* () {
        const rows = yield* runRetrySafeDatabaseOperation(
          "mark preview fulfillment delivered",
          db
            .update(workspaceReservations)
            .set({
              fulfillmentState: "fulfilled",
              fulfilledAt: sql`coalesce(${workspaceReservations.fulfilledAt}, now())`,
              updatedAt: Temporal.Now.instant(),
            })
            .where(
              and(
                eq(workspaceReservations.id, orderId),
                eq(workspaceReservations.paymentState, "paid"),
                eq(workspaceReservations.fulfillmentState, "processing"),
                isNotNull(workspaceReservations.reservationConfirmedAt),
                isNotNull(workspaceReservations.dotyposReservationId)
              )
            )
            .returning({ id: workspaceReservations.id })
        );

        if (rows[0]?.id !== orderId) {
          const current = yield* readCheckoutRowFromDatabase(db, orderId);
          return current?.fulfillment_state === "fulfilled"
            ? current
            : undefined;
        }

        return yield* readCheckoutRowFromDatabase(db, orderId);
      }),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: `preview fulfillment marker for ${orderId}`,
        timeoutMs: config.timeouts.datasource,
      }
    );

    yield* tryWorkspaceE2ESync("assert preview fulfillment marker row", () =>
      assert(row, "preview fulfillment marker row missing")
    );
    log("Preview fulfillment delivery marker applied");
  });

const isPostgresComplete = (row: CheckoutRow, config: DatasourceConfig) =>
  row.reservation_state === "confirmed" &&
  row.payment_state === "paid" &&
  row.fulfillment_state === "fulfilled" &&
  row.payment_attempt_state === "paid" &&
  row.currency === config.expectedCurrency &&
  row.webhook_state === "processed";

const isInternalPostgresComplete = (
  row: CheckoutRow,
  config: DatasourceConfig
) =>
  row.reservation_state === "confirmed" &&
  row.payment_state === "paid" &&
  row.fulfillment_state === "fulfilled" &&
  row.payment_attempt_state === "paid" &&
  row.provider === "internal" &&
  row.amount_value === 0 &&
  row.currency === config.expectedCurrency;

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

const assertInternalPostgresRow = (
  row: CheckoutRow,
  data: CheckoutData,
  config: DatasourceConfig
): Effect.Effect<void, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("assert internal Postgres checkout row", () => {
    assert(row.reservation_state === "confirmed", "reservation not confirmed");
    assert(row.payment_state === "paid", "reservation payment was not paid");
    assert(
      row.fulfillment_state === "fulfilled",
      "reservation fulfillment was not fulfilled"
    );
    assert(row.active_payment_attempt_id, "active payment attempt missing");
    assert(
      row.payment_attempt_id === row.active_payment_attempt_id,
      "active payment attempt mismatch"
    );
    assert(row.provider === "internal", "payment provider should be internal");
    assert(row.payment_attempt_state === "paid", "internal attempt not paid");
    assert(row.amount_value === 0, "internal payment amount should be zero");
    assert(row.amount_exponent !== null, "payment amount exponent missing");
    assert(
      row.currency === config.expectedCurrency,
      `expected ${config.expectedCurrency} currency`
    );
    assert(
      row.provider_order_id === null,
      "internal provider order ID present"
    );
    assert(row.security_token === null, "internal security token present");
    assert(
      row.provider_redirect_url === null,
      "internal provider redirect URL present"
    );
    assert(
      row.last_webhook_event_id === null,
      "internal webhook event ID present"
    );
    assert(
      row.last_provider_operation_id === null,
      "internal provider operation ID present"
    );
    assert(
      row.last_provider_status === null,
      "internal provider status present"
    );
    assert(row.payment_failure_code === null, "internal failure code present");
    assert(row.webhook_id === null, "internal payment created a webhook row");
    assert(row.paid_at, "paid_at missing");
    assert(row.reservation_confirmed_at, "reservation confirmation missing");
    assert(row.fulfilled_at, "fulfilled_at missing");
    deepStrictEqual(
      row.reservation_details,
      data.expectedReservationDetails,
      "unexpected reservation details"
    );
  });

const assertInternalDiscountState = (
  db: DatabaseClient,
  row: CheckoutRow
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const rows = yield* runRetrySafeDatabaseOperation(
      "read internal discount application and claim",
      db
        .select({
          subtotal_before_value: discountApplications.subtotalBeforeValue,
          applied_amount_value: discountApplications.appliedAmountValue,
          subtotal_after_value: discountApplications.subtotalAfterValue,
          redemption_state: discountCodeRedemptions.state,
          redeemed_at: discountCodeRedemptions.redeemedAt,
        })
        .from(discountApplications)
        .leftJoin(
          discountCodeRedemptions,
          eq(discountCodeRedemptions.applicationId, discountApplications.id)
        )
        .where(
          eq(
            discountApplications.paymentAttemptId,
            row.payment_attempt_id ?? ""
          )
        )
    );

    yield* tryWorkspaceE2ESync(
      "assert internal discount application and claim",
      () => assertInternalDiscountApplications(rows)
    );
  });

interface InternalDiscountApplicationRow {
  readonly applied_amount_value: number;
  readonly redemption_state: string | null;
  readonly redeemed_at: Date | Temporal.Instant | null;
  readonly subtotal_after_value: number;
  readonly subtotal_before_value: number;
}

export const assertInternalDiscountApplications = (
  rows: readonly InternalDiscountApplicationRow[]
) => {
  const redeemedApplications = rows.filter(
    ({ redemption_state }) => redemption_state === "redeemed"
  );
  assert(
    redeemedApplications.length === 1,
    "expected one redeemed code application"
  );
  const application = redeemedApplications[0];
  assert(application, "redeemed code application missing");
  assert(
    application.applied_amount_value === application.subtotal_before_value,
    "discount did not cover the full subtotal"
  );
  assert(
    application.subtotal_after_value === 0,
    "discount subtotal after should be zero"
  );
  assert(
    application.redemption_state === "redeemed",
    "discount code claim was not redeemed"
  );
  assert(application.redeemed_at, "discount code redeemed_at missing");
};

const assertLegalEvidence = (
  db: DatabaseClient,
  orderId: string,
  locale: CheckoutData["locale"]
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const rows = yield* runRetrySafeDatabaseOperation(
      "read legal evidence rows",
      db
        .select({
          accepted: legalEvidenceEvents.accepted,
          document_key: legalEvidenceEvents.documentKey,
          hash_algorithm: legalEvidenceEvents.hashAlgorithm,
          locale: legalEvidenceEvents.locale,
          source: legalEvidenceEvents.source,
        })
        .from(legalEvidenceEvents)
        .where(eq(legalEvidenceEvents.workspaceReservationId, orderId))
    );

    yield* tryWorkspaceE2ESync("assert legal evidence rows", () =>
      assertLegalEvidenceRows(rows, locale)
    );
  });

export const assertLegalEvidenceRows = (
  rows: readonly {
    readonly accepted: boolean;
    readonly document_key: string;
    readonly hash_algorithm: string;
    readonly locale: string;
    readonly source: string;
  }[],
  locale: CheckoutData["locale"]
) => {
  const expected = new Set([
    "privacyPolicy:reservation_submit",
    "marketingCommunications:reservation_submit",
    "termsAndConditions:payment_submit",
    "operatingRules:payment_submit",
  ]);

  for (const row of rows) {
    if (row.document_key !== "marketingCommunications") {
      assert(
        row.accepted,
        `legal evidence ${row.document_key} was not accepted`
      );
    }
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
};

const assertNoLocalPii = (
  db: DatabaseClient,
  orderId: string,
  paymentAttemptId: string | null,
  webhookEventId: string | null,
  data: CheckoutData
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const patterns = [data.email, data.phone, data.name, data.message].map(
      (value) => `%${value}%`
    );
    const [
      [reservationCount],
      [attemptCount],
      [webhookCount],
      [legalEvidenceCount],
    ] = yield* runRetrySafeDatabaseOperation(
      "scan checkout tables for local PII",
      Effect.all(
        [
          db
            .select({ count: count() })
            .from(workspaceReservations)
            .where(
              and(
                eq(workspaceReservations.id, orderId),
                or(
                  ...patterns.map((pattern) =>
                    ilike(
                      sql`to_jsonb(${workspaceReservations})::text`,
                      pattern
                    )
                  )
                )
              )
            ),
          db
            .select({ count: count() })
            .from(paymentAttempts)
            .where(
              and(
                eq(paymentAttempts.id, paymentAttemptId ?? ""),
                or(
                  ...patterns.map((pattern) =>
                    ilike(sql`to_jsonb(${paymentAttempts})::text`, pattern)
                  )
                )
              )
            ),
          db
            .select({ count: count() })
            .from(webhookEvents)
            .where(
              and(
                eq(webhookEvents.id, webhookEventId ?? ""),
                or(
                  ...patterns.map((pattern) =>
                    ilike(sql`to_jsonb(${webhookEvents})::text`, pattern)
                  )
                )
              )
            ),
          db
            .select({ count: count() })
            .from(legalEvidenceEvents)
            .where(
              and(
                eq(legalEvidenceEvents.workspaceReservationId, orderId),
                or(
                  ...patterns.map((pattern) =>
                    ilike(sql`to_jsonb(${legalEvidenceEvents})::text`, pattern)
                  )
                )
              )
            ),
        ],
        { concurrency: "inherit" }
      )
    );

    yield* tryWorkspaceE2ESync(
      "assert checkout tables do not contain local PII",
      () =>
        assert(
          (reservationCount?.count ?? 0) +
            (attemptCount?.count ?? 0) +
            (webhookCount?.count ?? 0) +
            (legalEvidenceCount?.count ?? 0) ===
            0,
          "local checkout tables contain test PII"
        )
    );
  });
