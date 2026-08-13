import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const readAppFile = (path: string) =>
  Bun.file(new URL(`../../${path}`, import.meta.url)).text();

const parseMigrationSnapshot = (snapshot: string) =>
  JSON.parse(snapshot) as {
    readonly id: string;
    readonly prevIds: readonly string[];
  };

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
    expect(schemaIndex).toContain("./invoice-email-deliveries");
    expect(schemaIndex).toContain("./invoices");
    expect(schemaIndex).toContain("./reservation-access-grants");
    expect(schemaIndex).not.toContain("checkout-return-state-tokens");
    expect(schemaIndex).not.toContain("payment-orders");
  });

  test("reservation access stores its time-bound credential as text", async () => {
    const schema = await readAppFile("db/schema/reservation-access-grants.ts");
    const migration = await readAppFile(
      "db/migrations/20260813084941_reservation_access_grants/migration.sql"
    );

    expect(schema).toContain('text("access_code")');
    expect(schema).not.toContain("encryptedAccessCode");
    expect(schema).not.toContain("bytea(");
    expect(migration).toContain('CREATE TABLE "reservation_access_grants"');
    expect(migration).not.toContain('CREATE TABLE "discount_targets"');
    expect(migration).not.toContain('DROP TABLE "discount_product_targets"');
  });

  test("only the lock enforces reservation access validity", async () => {
    const [repository, cronRoute, customerAccess] = await Promise.all([
      readAppFile(
        "features/reservation-access/backend/reservation-access.repository.ts"
      ),
      readAppFile("app/api/cron/workspace/reservation-holds/route.ts"),
      readAppFile("features/reservation/backend/reservation-access.service.ts"),
    ]);

    expect(repository).not.toContain("clearExpiredAccessCodes");
    expect(repository).not.toContain('state: "expired"');
    expect(cronRoute).not.toContain("ReservationAccessService");
    expect(customerAccess).not.toContain("getReservationAccessCodeWindowState");
  });

  test("accounting PII exception stores only PostgreSQL ciphertext", async () => {
    const schema = await readAppFile(
      "db/schema/accounting-document-snapshots.ts"
    );
    const [migration, invoiceMigration] = await Promise.all([
      readAppFile("db/migrations/20260810143334_slim_morlun/migration.sql"),
      readAppFile("db/migrations/20260811173859_issued_invoices/migration.sql"),
    ]);

    expect(schema).toContain('bytea("encrypted_snapshot")');
    expect(schema).not.toContain("jsonb(");
    expect(schema).not.toContain("schemaVersion");
    for (const fragment of piiColumnFragments) {
      expect(schema.toLowerCase()).not.toContain(`"${fragment}"`);
    }
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    expect(migration).toContain("accounting_document_snapshots_immutable");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("state IN ('failed', 'cancelled', 'expired')");
    expect(invoiceMigration).toContain(
      'ALTER TABLE "accounting_document_snapshots" DROP CONSTRAINT IF EXISTS "accounting_document_snapshots_schema_version_check"'
    );
    expect(invoiceMigration).toContain(
      'DROP COLUMN IF EXISTS "schema_version"'
    );
  });

  test("issued invoices remain ciphertext-only, immutable, and source-bound", async () => {
    const schema = await readAppFile("db/schema/invoices.ts");
    const migration = await readAppFile(
      "db/migrations/20260811173859_issued_invoices/migration.sql"
    );

    expect(schema).toContain('bytea("encrypted_document")');
    expect(schema).not.toContain("jsonb(");
    expect(schema).not.toContain("schemaVersion");
    expect(migration).not.toContain("invoices_schema_version");
    for (const fragment of piiColumnFragments) {
      expect(schema.toLowerCase()).not.toContain(`"${fragment}"`);
    }
    expect(migration).toContain("invoices_validate_source");
    expect(migration).toContain("active_payment_attempt_id = attempt.id");
    expect(migration).toContain("invoices_immutable");
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "invoices"');
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "invoice_number_counters"'
    );
    expect(schema).not.toContain("invoices_number_format_check");
    expect(migration).not.toContain(
      'CONSTRAINT "invoices_number_format_check" CHECK'
    );
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "invoices_number_format_check"'
    );
    expect(migration).not.toContain("nextval(");
    expect(schema).not.toContain("between 2000 and 9999");
    expect(migration).not.toContain("between 2000 and 9999");
    expect(migration).not.toContain("999999");
  });

  test("invoice email delivery state stores no recipient or document payload", async () => {
    const [schema, migration] = await Promise.all([
      readAppFile("db/schema/invoice-email-deliveries.ts"),
      readAppFile(
        "db/migrations/20260812144849_married_may_parker/migration.sql"
      ),
    ]);

    expect(schema).toContain('"invoice_email_deliveries"');
    expect(schema).toContain('text("provider_delivery_id")');
    expect(schema).toContain('integer("attempt_count")');
    expect(schema).not.toContain("bytea(");
    expect(schema).not.toContain("jsonb(");
    expect(migration).toContain('CREATE TABLE "invoice_email_deliveries"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "invoice_email_deliveries_invoice_audience_unique_idx"'
    );
    for (const fragment of piiColumnFragments) {
      expect(schema.toLowerCase()).not.toContain(`"${fragment}"`);
    }
  });

  test("reservation purpose is the only plaintext billing classification", async () => {
    const [schema, migration] = await Promise.all([
      readAppFile("db/schema/workspace-reservations.ts"),
      readAppFile(
        "db/migrations/20260813150734_optimal_sugar_man/migration.sql"
      ),
    ]);

    expect(schema).toContain('text("reservation_purpose")');
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "reservation_purpose"'
    );
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "workspace_reservations_purpose_check"'
    );
    expect(migration).toContain(
      "CHECK (\"reservation_purpose\" is null or \"reservation_purpose\" in ('personal', 'business'))"
    );
    for (const forbiddenColumn of [
      "billing_address",
      "company_id",
      "company_name",
      "postal_code",
      "vat_id",
    ]) {
      expect(schema).not.toContain(`"${forbiddenColumn}"`);
      expect(migration).not.toContain(`"${forbiddenColumn}"`);
    }
  });

  test("reconciles the previously deployed preview invoice schema", async () => {
    const migration = await readAppFile(
      "db/migrations/20260811173859_issued_invoices/migration.sql"
    );

    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS "invoice_number_counters"'
    );
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "invoice_number_counters_year_check"'
    );
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "invoice_number_counters_sequence_check"'
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "invoice_number_counters_sequence_check" CHECK ("last_sequence" > 0)'
    );
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "invoices_numbering_year_check"'
    );
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "invoices_numbering_sequence_check"'
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "invoices_numbering_sequence_check" CHECK ("numbering_sequence" > 0)'
    );
  });

  test("follows the corrected migration head before issuing invoices", async () => {
    const [discountJson, invoiceJson, deliveryJson, accessJson, purposeJson] =
      await Promise.all([
        readAppFile("db/migrations/20260810143301_late_morbius/snapshot.json"),
        readAppFile(
          "db/migrations/20260811173859_issued_invoices/snapshot.json"
        ),
        readAppFile(
          "db/migrations/20260812144849_married_may_parker/snapshot.json"
        ),
        readAppFile(
          "db/migrations/20260813084941_reservation_access_grants/snapshot.json"
        ),
        readAppFile(
          "db/migrations/20260813150734_optimal_sugar_man/snapshot.json"
        ),
      ]);
    const discountSnapshot = parseMigrationSnapshot(discountJson);
    const invoiceSnapshot = parseMigrationSnapshot(invoiceJson);
    const deliverySnapshot = parseMigrationSnapshot(deliveryJson);
    const accessSnapshot = parseMigrationSnapshot(accessJson);
    const purposeSnapshot = parseMigrationSnapshot(purposeJson);

    expect(invoiceSnapshot.prevIds).toEqual([discountSnapshot.id]);
    expect(deliverySnapshot.prevIds).toEqual([invoiceSnapshot.id]);
    expect(accessSnapshot.prevIds).toEqual([deliverySnapshot.id]);
    expect(purposeSnapshot.prevIds).toEqual([accessSnapshot.id]);
    expect(invoiceJson).not.toContain('"schema_version"');
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
    const paymentLifecycleRepository = await readAppFile(
      "features/checkout/backend/repositories/payment-lifecycle.repository.ts"
    );
    const discountAdministration = await readAppFile(
      "features/discounts/admin/discount-administration.service.ts"
    );
    const discountCodeRepository = await readAppFile(
      "features/discounts/promotion-code.repository.ts"
    );
    const accountingSql = await readAppFile(
      "features/accounting/backend/accounting-snapshot-sql.ts"
    );
    const reservationAccessRepository = await readAppFile(
      "features/reservation-access/backend/reservation-access.repository.ts"
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
    expect(reservationAccessRepository).toContain(
      "accessCode: sensitiveDatabaseParameter(input.accessCode)"
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
