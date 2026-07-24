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
    expect(schemaIndex).toContain("./payment-attempts");
    expect(schemaIndex).toContain("./webhook-events");
    expect(schemaIndex).toContain("./legal-evidence-events");
    expect(schemaIndex).toContain("./discounts");
    expect(schemaIndex).toContain("./discount-applications");
    expect(schemaIndex).not.toContain("checkout-return-state-tokens");
    expect(schemaIndex).not.toContain("payment-orders");
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

  test("repository transitions are state and active-attempt guarded", async () => {
    const reservationRepository = await readAppFile(
      "features/reservation/backend/workspace-reservation.repository.ts"
    );
    const paymentAttemptRepository = await readAppFile(
      "features/checkout/backend/repositories/payment-attempt.repository.ts"
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

  test("payment-attempt creation atomically excludes unresolved provider attachment recovery", async () => {
    const repository = await Bun.file(
      new URL(
        "../../features/checkout/backend/repositories/payment-attempt.repository.ts",
        import.meta.url
      )
    ).text();
    const createSection = repository.slice(
      repository.indexOf('create: Effect.fn("paymentAttempts.create")'),
      repository.indexOf('findById: Effect.fn("paymentAttempts.findById")')
    );

    expect(createSection).toContain("db.transaction(");
    expect(createSection).toContain(
      "hasNoUnresolvedProviderAttachmentRecovery()"
    );
    expect(createSection.indexOf(".insert(paymentAttempts)")).toBeLessThan(
      createSection.indexOf(".update(workspaceReservations)")
    );
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
      "features/checkout/backend/repositories/payment-attempt.repository.ts"
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

    const providerBoundary = source.indexOf(
      "reservations.beginProviderHoldCreation"
    );
    const providerCreate = source.indexOf("createWorkspaceDotyposReservation(");

    expect(source.indexOf("reservations.acquireDraft({")).toBeLessThan(
      providerBoundary
    );
    expect(source.indexOf("reservations.claimHoldCreation")).toBeLessThan(
      providerBoundary
    );
    expect(
      source.indexOf("yield* prepareWorkspaceDotyposReservation({")
    ).toBeLessThan(providerBoundary);
    expect(providerBoundary).toBeLessThan(providerCreate);
  });
});
