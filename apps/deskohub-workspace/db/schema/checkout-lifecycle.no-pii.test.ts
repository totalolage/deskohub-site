import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const readAppFile = (path: string) =>
  Bun.file(new URL(`../../${path}`, import.meta.url)).text();

const piiColumnFragments = [
  "customer_name",
  "customer_email",
  "customer_phone",
  "email",
  "phone",
  "name",
  "message_json",
  "raw_payload",
  "raw_body",
  "provider_payload",
  "customer_info",
] as const;

describe("workspace checkout lifecycle no-PII persistence contract", () => {
  test("schema exports only target lifecycle tables", async () => {
    const schemaIndex = await readAppFile("db/schema/index.ts");

    expect(schemaIndex).toContain("./workspace-reservations");
    expect(schemaIndex).toContain("./payment-attempts");
    expect(schemaIndex).toContain("./webhook-events");
    expect(schemaIndex).toContain("./legal-evidence-events");
    expect(schemaIndex).toContain("./operational-events");
    expect(schemaIndex).not.toContain("checkout-return-state-tokens");
    expect(schemaIndex).not.toContain("payment-orders");
  });

  test("baseline migration does not create forbidden or PII-capable columns", async () => {
    const migration = await readAppFile(
      "db/migrations/0000_free_morgan_stark.sql"
    );
    const lowerMigration = migration.toLowerCase();

    expect(lowerMigration).not.toContain("checkout_return_state_tokens");
    expect(lowerMigration).not.toContain("payment_orders");
    for (const fragment of piiColumnFragments) {
      expect(lowerMigration).not.toContain(`"${fragment}"`);
    }
  });

  test("intent key uses JSON.stringify payload and does not use tuple delimiter", async () => {
    const source = await readAppFile(
      "features/reservation/actions/prepare-pay-state.ts"
    );

    expect(source).toContain('schema: "workspace-reservation-intent-key"');
    expect(source).toContain("reservationIntentId");
    expect(source).toContain(".update(JSON.stringify(payload))");
    expect(source).not.toContain('.join("\\u001f")');
    expect(source).not.toContain("Effect.annotateLogs(input)");
  });

  test("operational event messages are derived from typed templates", async () => {
    const { parseOperationalEventInput } = await import(
      "@/features/checkout/backend/operational-event.repository"
    );

    expect(
      parseOperationalEventInput({
        eventType: "workspace_reservation_hold_cancelled",
        severity: "info",
      }).message
    ).toBe("Workspace reservation hold was cancelled.");
    expect(() =>
      parseOperationalEventInput({
        eventType: "workspace_reservation_hold_attach_failed",
        severity: "error",
        message: "Caller supplied arbitrary recovery detail",
      } as never)
    ).toThrow();
    expect(() =>
      parseOperationalEventInput({
        eventType: "workspace_reservation_hold_attach_failed",
        severity: "error",
        providerMessage: "Caller supplied provider detail",
      } as never)
    ).toThrow();

    const source = await readAppFile(
      "features/checkout/backend/operational-event.repository.ts"
    );
    expect(source).not.toContain("piiLikeMessagePattern");
    expect(source).not.toContain("messagePattern");
    expect(source).not.toContain("RegExp");
  });

  test("operational event messages reject arbitrary non-template text", async () => {
    const { parseOperationalEventInput } = await import(
      "@/features/checkout/backend/operational-event.repository"
    );

    expect(() =>
      parseOperationalEventInput({
        eventType: "workspace_reservation_hold_cancelled",
        severity: "warning",
        message: "Operator should inspect the customer note manually.",
      } as never)
    ).toThrow();
  });

  test("repository transitions are state and active-attempt guarded", async () => {
    const reservationRepository = await readAppFile(
      "features/reservation/backend/workspace-reservation.repository.ts"
    );
    const paymentAttemptRepository = await readAppFile(
      "features/checkout/backend/payment-attempt.repository.ts"
    );

    expect(reservationRepository).toContain(
      'eq(workspaceReservations.reservationState, "cancelling")'
    );
    expect(reservationRepository).toContain(
      'eq(workspaceReservations.paymentState, "pending")'
    );
    expect(reservationRepository).toContain(
      "workspaceReservations.reservationConfirmedAt} is null"
    );
    expect(reservationRepository).toContain(
      "workspaceReservations.activePaymentAttemptId"
    );
    expect(paymentAttemptRepository).toContain(
      'inArray(paymentAttempts.state, ["created", "pending"])'
    );
    expect(paymentAttemptRepository).toContain(
      'eq(paymentAttempts.state, "pending")'
    );
  });

  test("webhook duplicate handling is retry-safe", async () => {
    const source = await readAppFile(
      "features/checkout/backend/nexi-webhook.service.ts"
    );
    const repository = await readAppFile(
      "features/checkout/backend/webhook-event.repository.ts"
    );

    expect(repository).toContain(
      '| { readonly status: "duplicate"; readonly event: WebhookEvent }'
    );
    expect(source).toContain('received.event.state === "processed"');
    expect(source).toContain("webhookEvents.claimRetry");
    expect(source).toContain("Retrying unprocessed duplicate Nexi webhook");
    expect(repository).toContain('ne(webhookEvents.state, "processed")');
  });

  test("webhook terminal payment transitions use one transaction", async () => {
    const source = await readAppFile(
      "features/checkout/backend/nexi-webhook.service.ts"
    );
    const repository = await readAppFile(
      "features/checkout/backend/payment-attempt.repository.ts"
    );

    expect(source).toContain("paymentAttempts.markPaidForReservation");
    expect(source).toContain("paymentAttempts.markTerminalForReservation");
    expect(repository).toContain("db.transaction(");
    expect(repository).toContain(
      "Only the active pending attempt on a held reservation can mark payment paid."
    );
    expect(repository).toContain(
      "Only the active pending attempt on a held reservation can mark payment terminal."
    );
  });

  test("reservation submit acquires local hold claim before remote Dotypos hold", async () => {
    const source = await readAppFile(
      "features/reservation/actions/prepare-pay-state.ts"
    );

    expect(source.indexOf("reservations.createDraft({")).toBeLessThan(
      source.indexOf("createWorkspaceDotyposReservation({")
    );
    expect(source.indexOf("reservations.claimHoldCreation")).toBeLessThan(
      source.indexOf("createWorkspaceDotyposReservation({")
    );
  });
});
