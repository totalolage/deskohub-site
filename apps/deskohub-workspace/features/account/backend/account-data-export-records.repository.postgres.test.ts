import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AccountDataExportRecordsRepository } from "./account-data-export-records.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID();
const uniqueDotyposId = () =>
  `${Math.floor(Math.random() * 900000) + 100000}${Math.floor(
    Math.random() * 900
  )}` as DotyposCustomerId;

const insertWorkspaceReservation = async (input: {
  readonly id: WorkspaceReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) => {
  await testDatabase!.pool.query(
    `insert into workspace_reservations
      (id, checkout_attempt_key, dotypos_customer_id, dotypos_reservation_id,
       reservation_state, payment_state, fulfillment_state, reservation_details, locale)
     values ($1, $2, $3, $4, 'confirmed', 'not_started', 'not_started', '{"kind":"cowork","entryTier":"basic","coffee":false}', 'en-US')`,
    [
      input.id,
      `attempt-${uniqueId()}`,
      input.dotyposCustomerId,
      `dotypos-${uniqueId()}`,
    ]
  );
};

const insertPaymentAttempt = async (input: {
  readonly id: string;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly withSecrets: boolean;
}) => {
  await testDatabase!.pool.query(
    `insert into payment_attempts
      (id, workspace_reservation_id, provider, provider_order_id, security_token,
       state, amount_value, amount_exponent, currency, provider_redirect_url)
     values ($1, $2, 'nexi', $3, $4, 'paid', 12000, 2, 'CZK', $5)`,
    [
      input.id,
      input.workspaceReservationId,
      `order-${uniqueId()}`,
      input.withSecrets ? `security-token-${uniqueId()}` : null,
      input.withSecrets
        ? `https://pay.example.test/redirect-${uniqueId()}`
        : null,
    ]
  );
};

const markReservationPaid = async (input: {
  readonly id: WorkspaceReservationId;
  readonly paymentAttemptId: string;
}) => {
  await testDatabase!.pool.query(
    `update workspace_reservations
       set payment_state = 'paid', paid_at = now(), active_payment_attempt_id = $2
     where id = $1`,
    [input.id, input.paymentAttemptId]
  );
};

const insertDiscountApplication = async (input: {
  readonly id: string;
  readonly paymentAttemptId: string;
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly sequence: number;
}) => {
  await testDatabase!.pool.query(
    `insert into discount_applications
      (id, payment_attempt_id, workspace_reservation_id, sequence, public_discount_id, label,
       adjustment, product_identity, provenance,
       subtotal_before_value, subtotal_before_exponent, subtotal_before_currency,
       applied_amount_value, applied_amount_exponent, applied_amount_currency,
       subtotal_after_value, subtotal_after_exponent, subtotal_after_currency)
     values ($1, $2, $3, $4, $5, $6, '{}', '{}', '{}', 12000, 2, 'CZK', 1000, 2, 'CZK', 11000, 2, 'CZK')`,
    [
      input.id,
      input.paymentAttemptId,
      input.workspaceReservationId,
      input.sequence,
      `discount-${uniqueId()}`,
      "Opening discount",
    ]
  );
};

const insertInvoice = async (input: {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly workspaceReservationId: WorkspaceReservationId | null;
  readonly paymentAttemptId: string | null;
}) => {
  const sequence = Math.floor(Math.random() * 9000000) + 1000000;
  const invoiceNumber = `INV-${uniqueId()}`;
  const result = await testDatabase!.pool.query<{ id: string }>(
    `insert into invoices
      (workspace_reservation_id, payment_attempt_id, dotypos_customer_id,
       invoice_number, numbering_year, numbering_sequence, key_id, encrypted_document, issued_at)
     values ($1, $2, $3, $4, 2026, $5, 'TESTKEY', '\\x00', '2026-06-01T12:00:00+02:00')
     returning id`,
    [
      input.workspaceReservationId,
      input.paymentAttemptId,
      input.dotyposCustomerId,
      invoiceNumber,
      sequence,
    ]
  );
  return { id: result.rows[0]!.id, invoiceNumber };
};

const insertDocumentSnapshot = async (input: {
  readonly paymentAttemptId: string;
  readonly workspaceReservationId: WorkspaceReservationId;
}) => {
  await testDatabase!.pool.query(
    `insert into accounting_document_snapshots
      (payment_attempt_id, workspace_reservation_id, key_id, encrypted_snapshot)
     values ($1, $2, 'TESTKEY', '\\x00')`,
    [input.paymentAttemptId, input.workspaceReservationId]
  );
};

const insertInvoiceDelivery = async (input: {
  readonly invoiceId: string;
  readonly audience: "customer" | "internal";
}) => {
  await testDatabase!.pool.query(
    `insert into invoice_email_deliveries
      (invoice_id, audience, state, attempt_count)
     values ($1, $2, 'processing', 1)`,
    [input.invoiceId, input.audience]
  );
};

const insertLegalEvidenceEvent = async (input: {
  readonly workspaceReservationId: WorkspaceReservationId | null;
}) => {
  await testDatabase!.pool.query(
    `insert into legal_evidence_events
      (workspace_reservation_id, document_key, document_path, document_hash,
       hash_algorithm, accepted, accepted_at, locale, source)
     values ($1, 'terms', '/legal/terms.md', $2, 'sha256', true, now(), 'en-US', 'checkout')`,
    [input.workspaceReservationId, `hash-${uniqueId()}`]
  );
};

const insertAccessGrant = async (input: {
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly issued: boolean;
}) => {
  await testDatabase!.pool.query(
    `insert into reservation_access_grants
       (workspace_reservation_id, device_id, state, provider_credential_id, access_code,
        reservation_starts_at, access_starts_at, access_ends_at, issued_at)
      values ($1, $2, $3, $4, $5, '2026-09-01T09:00:00Z', '2026-09-01T08:45:00Z', '2026-09-01T11:15:00Z', $6)`,
    [
      input.workspaceReservationId,
      `device-${uniqueId()}`,
      input.issued ? "issued" : "provisioning",
      input.issued ? `pin-id-${uniqueId()}` : null,
      input.issued ? `${Math.floor(Math.random() * 900000) + 100000}` : null,
      input.issued ? new Date().toISOString() : null,
    ]
  );
};

const insertLatePaymentRecovery = async (input: {
  readonly paymentAttemptId: string;
  readonly workspaceReservationId: WorkspaceReservationId;
}) => {
  await testDatabase!.pool.query(
    `insert into late_payment_recoveries
      (payment_attempt_id, workspace_reservation_id, webhook_event_id,
       state, original_dotypos_reservation_id, verified_paid_at)
     values ($1, $2, $3, 'pending', $4, now())`,
    [
      input.paymentAttemptId,
      input.workspaceReservationId,
      `webhook-${uniqueId()}`,
      `dotypos-${uniqueId()}`,
    ]
  );
};

describe.skipIf(!testDatabase)(
  "AccountDataExportRecordsRepository on disposable Postgres",
  () => {
    test("returns only the verified customer's records across every join, and never a secret", async () => {
      const ownCustomerId = uniqueDotyposId();
      const foreignCustomerId = uniqueDotyposId();

      const ownReservationId = workspaceReservationIdSchema.make(
        `workspace-${uniqueId()}`
      );
      const foreignReservationId = workspaceReservationIdSchema.make(
        `workspace-${uniqueId()}`
      );
      await insertWorkspaceReservation({
        id: ownReservationId,
        dotyposCustomerId: ownCustomerId,
      });
      await insertWorkspaceReservation({
        id: foreignReservationId,
        dotyposCustomerId: foreignCustomerId,
      });

      const ownAttemptId = `attempt-${uniqueId()}`;
      const foreignAttemptId = `attempt-${uniqueId()}`;
      await insertPaymentAttempt({
        id: ownAttemptId,
        workspaceReservationId: ownReservationId,
        withSecrets: true,
      });
      await insertPaymentAttempt({
        id: foreignAttemptId,
        workspaceReservationId: foreignReservationId,
        withSecrets: true,
      });

      await insertDiscountApplication({
        id: `discount-${uniqueId()}`,
        paymentAttemptId: ownAttemptId,
        workspaceReservationId: ownReservationId,
        sequence: 0,
      });
      await insertDiscountApplication({
        id: `discount-${uniqueId()}`,
        paymentAttemptId: foreignAttemptId,
        workspaceReservationId: foreignReservationId,
        sequence: 0,
      });

      await markReservationPaid({
        id: ownReservationId,
        paymentAttemptId: ownAttemptId,
      });
      await markReservationPaid({
        id: foreignReservationId,
        paymentAttemptId: foreignAttemptId,
      });

      await insertDocumentSnapshot({
        paymentAttemptId: ownAttemptId,
        workspaceReservationId: ownReservationId,
      });
      await insertDocumentSnapshot({
        paymentAttemptId: foreignAttemptId,
        workspaceReservationId: foreignReservationId,
      });

      const ownInvoice = await insertInvoice({
        dotyposCustomerId: ownCustomerId,
        workspaceReservationId: ownReservationId,
        paymentAttemptId: ownAttemptId,
      });
      const foreignInvoice = await insertInvoice({
        dotyposCustomerId: foreignCustomerId,
        workspaceReservationId: foreignReservationId,
        paymentAttemptId: foreignAttemptId,
      });

      await insertInvoiceDelivery({
        invoiceId: ownInvoice.id,
        audience: "customer",
      });
      await insertInvoiceDelivery({
        invoiceId: ownInvoice.id,
        audience: "internal",
      });
      await insertInvoiceDelivery({
        invoiceId: foreignInvoice.id,
        audience: "customer",
      });

      await insertLegalEvidenceEvent({
        workspaceReservationId: ownReservationId,
      });
      await insertLegalEvidenceEvent({
        workspaceReservationId: foreignReservationId,
      });
      await insertLegalEvidenceEvent({ workspaceReservationId: null });

      await insertAccessGrant({
        workspaceReservationId: ownReservationId,
        issued: true,
      });
      await insertAccessGrant({
        workspaceReservationId: foreignReservationId,
        issued: true,
      });

      await insertLatePaymentRecovery({
        paymentAttemptId: ownAttemptId,
        workspaceReservationId: ownReservationId,
      });
      await insertLatePaymentRecovery({
        paymentAttemptId: foreignAttemptId,
        workspaceReservationId: foreignReservationId,
      });

      const records = await Effect.runPromise(
        Effect.gen(function* () {
          const repository = yield* AccountDataExportRecordsRepository;
          return yield* repository.loadCustomerRecords(ownCustomerId);
        }).pipe(
          Effect.provide(
            AccountDataExportRecordsRepository.Default.pipe(
              Layer.provide(testDatabase!.layer)
            )
          )
        )
      );

      expect(
        records.reservations.map((row) => row.workspaceReservationId)
      ).toEqual([ownReservationId]);
      expect(records.payments.map((row) => row.workspaceReservationId)).toEqual(
        [ownReservationId]
      );
      expect(
        records.discountApplications.map((row) => row.workspaceReservationId)
      ).toEqual([ownReservationId]);
      expect(records.invoices.map((row) => row.invoiceNumber)).toEqual([
        ownInvoice.invoiceNumber,
      ]);
      expect(records.invoices[0]?.documentSnapshotRecordedAt).not.toBeNull();
      expect(records.invoiceDeliveries.map((row) => row.invoiceNumber)).toEqual(
        [ownInvoice.invoiceNumber]
      );
      expect(
        records.legalEvidenceEvents.map((row) => row.workspaceReservationId)
      ).toEqual([ownReservationId]);
      expect(
        records.accessGrants.map((row) => row.workspaceReservationId)
      ).toEqual([ownReservationId]);
      expect(
        records.latePaymentRecoveries.map((row) => row.workspaceReservationId)
      ).toEqual([ownReservationId]);

      // No credential or provider secret survives anywhere in the result:
      // neither as a projected key nor as a leaked stored value.
      const serialized = JSON.stringify(records);
      expect(serialized).not.toMatch(
        /security_?[Tt]oken|accessCode|access_code|providerCredentialId|providerRedirectUrl|redirectUrl|deviceId|encrypted/i
      );
      expect(serialized).not.toContain("security-token-");
      expect(serialized).not.toContain("pin-id-");
      expect(serialized).not.toContain("https://pay.example.test");
    });

    test("returns empty lists for a customer with no records", async () => {
      const records = await Effect.runPromise(
        Effect.gen(function* () {
          const repository = yield* AccountDataExportRecordsRepository;
          return yield* repository.loadCustomerRecords(uniqueDotyposId());
        }).pipe(
          Effect.provide(
            AccountDataExportRecordsRepository.Default.pipe(
              Layer.provide(testDatabase!.layer)
            )
          )
        )
      );
      expect(records.reservations).toEqual([]);
      expect(records.payments).toEqual([]);
      expect(records.discountApplications).toEqual([]);
      expect(records.invoices).toEqual([]);
      expect(records.invoiceDeliveries).toEqual([]);
      expect(records.legalEvidenceEvents).toEqual([]);
      expect(records.accessGrants).toEqual([]);
      expect(records.latePaymentRecoveries).toEqual([]);
    });
  }
);
