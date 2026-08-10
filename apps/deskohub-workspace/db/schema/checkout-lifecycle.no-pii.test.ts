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
  test("schema exports the lifecycle and discount ledgers", async () => {
    const schemaIndex = await readAppFile("db/schema/index.ts");

    expect(schemaIndex).toContain("./workspace-reservations");
    expect(schemaIndex).toContain("./customer-marketing-consents");
    expect(schemaIndex).toContain("./payment-attempts");
    expect(schemaIndex).toContain("./webhook-events");
    expect(schemaIndex).toContain("./legal-evidence-events");
    expect(schemaIndex).toContain("./discounts");
    expect(schemaIndex).toContain("./discount-applications");
    expect(schemaIndex).toContain("./accounting-document-snapshots");
    expect(schemaIndex).toContain("./invoice-number-counters");
    expect(schemaIndex).toContain("./invoices");
    expect(schemaIndex).not.toContain("checkout-return-state-tokens");
    expect(schemaIndex).not.toContain("payment-orders");
  });

  test("accounting PII exception stores only PostgreSQL ciphertext", async () => {
    const schema = await readAppFile(
      "db/schema/accounting-document-snapshots.ts"
    );
    const migration = await readAppFile(
      "db/migrations/20260810143334_slim_morlun/migration.sql"
    );

    expect(schema).toContain('bytea("encrypted_snapshot")');
    expect(schema).not.toContain("jsonb(");
    for (const fragment of piiColumnFragments) {
      expect(schema.toLowerCase()).not.toContain(`"${fragment}"`);
    }
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    expect(migration).toContain("accounting_document_snapshots_immutable");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("state IN ('failed', 'cancelled', 'expired')");
  });

  test("issued invoices remain ciphertext-only, immutable, and source-bound", async () => {
    const schema = await readAppFile("db/schema/invoices.ts");
    const migration = await readAppFile(
      "db/migrations/20260810182916_issued_invoices/migration.sql"
    );

    expect(schema).toContain('bytea("encrypted_document")');
    expect(schema).not.toContain("jsonb(");
    for (const fragment of piiColumnFragments) {
      expect(schema.toLowerCase()).not.toContain(`"${fragment}"`);
    }
    expect(migration).toContain("invoices_validate_source");
    expect(migration).toContain("active_payment_attempt_id = attempt.id");
    expect(migration).toContain("invoices_immutable");
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "invoices"');
    expect(migration).toContain('CREATE TABLE "invoice_number_counters"');
    expect(migration).not.toContain("nextval(");
  });

  test("baseline migration does not create forbidden or PII-capable columns", async () => {
    const migration = await readAppFile(
      "db/migrations/20260602090946_free_morgan_stark/migration.sql"
    );
    const lowerMigration = migration.toLowerCase();

    expect(lowerMigration).not.toContain("checkout_return_state_tokens");
    expect(lowerMigration).not.toContain("payment_orders");
    for (const fragment of piiColumnFragments) {
      expect(lowerMigration).not.toContain(`"${fragment}"`);
    }
  });

  test("checkout keys use JSON.stringify payload and do not use tuple delimiters", async () => {
    const source = await readAppFile(
      "features/checkout/backend/checkout/checkout-session-key.server.ts"
    );

    expect(source).not.toContain("schema:");
    expect(source).not.toContain("schemaVersion");
    expect(source).toContain("checkoutSessionId");
    expect(source).toContain("checkoutAttemptId");
    expect(source).toContain(".update(JSON.stringify(payload))");
    expect(source).not.toContain('.join("\\u001f")');
    expect(source).not.toContain("Effect.annotateLogs(input)");
  });

  test("reservation action does not log future billing inputs", async () => {
    const source = await readAppFile(
      "features/reservation/actions/prepare-pay-state.ts"
    );
    const actionBoundary = source.slice(
      source.indexOf("const preparePayStateAction = defineWorkspaceAction")
    );

    expect(actionBoundary).toContain("logInput: false");
  });

  test("confidential database scalars are explicitly marked for query censorship", async () => {
    const reservationRepository = await readAppFile(
      "features/reservation/backend/workspace-reservation.repository.ts"
    );
    const paymentLifecycleRepository = await readAppFile(
      "features/checkout/backend/repositories/payment-lifecycle.repository.ts"
    );
    const discountAdministration = await readAppFile(
      "features/discounts/admin/discount-administration.service.ts"
    );
    const discountCodeRepository = await readAppFile(
      "features/discounts/discount-code.repository.ts"
    );
    const accountingSql = await readAppFile(
      "features/accounting/backend/accounting-snapshot-sql.ts"
    );

    expect(reservationRepository).toContain(
      "customerAccessCode: sensitiveDatabaseParameter("
    );
    expect(paymentLifecycleRepository).toContain(
      "securityToken: sensitiveDatabaseParameter("
    );
    expect(paymentLifecycleRepository).toContain(
      "providerRedirectUrl: sensitiveDatabaseParameter("
    );
    expect(discountAdministration).toContain(
      "code: sensitiveDatabaseParameter(input.code)"
    );
    expect(discountCodeRepository).toContain(
      "sensitiveDatabaseParameter(input.code)"
    );
    expect(accountingSql).toContain(
      `pgp_sym_encrypt(\${sensitiveDatabaseParameter(snapshotJson)}, \${sensitiveDatabaseParameter(secret)}`
    );
    expect(accountingSql).toContain(
      `pgp_sym_decrypt(\${encryptedSnapshot}, \${sensitiveDatabaseParameter(secret)})`
    );
  });

  test("repository transitions are state and active-attempt guarded", async () => {
    const reservationRepository = await readAppFile(
      "features/reservation/backend/workspace-reservation.repository.ts"
    );
    const paymentLifecycleRepository = await readAppFile(
      "features/checkout/backend/repositories/payment-lifecycle.repository.ts"
    );

    expect(reservationRepository).toContain(
      'eq(workspaceReservations.reservationState, "cancelling")'
    );
    expect(reservationRepository).toContain(
      "workspaceReservations.reservationConfirmedAt} is null"
    );
    expect(paymentLifecycleRepository).toContain(
      "workspaceReservations.activePaymentAttemptId"
    );
    expect(paymentLifecycleRepository).toContain(
      'eq(workspaceReservations.paymentState, "pending")'
    );
    expect(paymentLifecycleRepository).toContain(
      "inArray(paymentAttempts.state"
    );
    expect(paymentLifecycleRepository).toContain('"created"');
    expect(paymentLifecycleRepository).toContain('"pending"');
    expect(paymentLifecycleRepository).toContain('"paid"');
  });

  test("webhook duplicate handling is retry-safe", async () => {
    const source = await readAppFile(
      "features/checkout/backend/payment/nexi-webhook.service.ts"
    );
    const repository = await readAppFile(
      "features/checkout/backend/repositories/webhook-event.repository.ts"
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
      "features/checkout/backend/payment/nexi-webhook.service.ts"
    );
    const repository = await readAppFile(
      "features/checkout/backend/repositories/payment-lifecycle.repository.ts"
    );

    expect(source).toContain("paymentLifecycle.markPaid");
    expect(source).toContain("paymentLifecycle.markTerminal");
    expect(repository).toContain(".transaction(");
    expect(repository).toContain("yield* redeemCodeClaim");
    expect(repository).toContain("yield* releaseCodeClaim");
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
