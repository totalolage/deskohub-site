import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  accountingDocumentSnapshots,
  discountApplications,
  invoiceEmailDeliveries,
  invoices,
  latePaymentRecoveries,
  legalEvidenceEvents,
  paymentAttempts,
  reservationAccessGrants,
  workspaceReservations,
} from "@/db/schema";

/**
 * One customer-scoped workspace reservation record. The projection is
 * allowlisted: internal checkout keys, correlation identifiers, provider
 * reservation identifiers beyond the customer-facing one, and free-form
 * internals never leave the database boundary.
 */
export type ExportedWorkspaceReservation = {
  readonly workspaceReservationId: string;
  readonly dotyposReservationId: string | null;
  readonly reservationPurpose: string | null;
  readonly reservationState: string;
  readonly paymentState: string;
  readonly fulfillmentState: string;
  readonly locale: string;
  readonly reservationCreatedAt: string | null;
  readonly reservationConfirmedAt: string | null;
  readonly reservationCancelledAt: string | null;
  readonly paidAt: string | null;
  readonly fulfilledAt: string | null;
};

/**
 * One customer-scoped payment attempt: status and amount only. The security
 * token, provider redirect URL, provider order and operation identifiers,
 * webhook references, and provider statuses are excluded by construction.
 */
export type ExportedPaymentAttempt = {
  readonly workspaceReservationId: string;
  readonly provider: string;
  readonly state: string;
  readonly refundState: string;
  readonly amountValue: number;
  readonly amountExponent: number;
  readonly currency: string;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

/**
 * One customer-scoped discount application: label and amounts. The internal
 * adjustment, product-identity, and provenance payloads are excluded.
 */
export type ExportedDiscountApplication = {
  readonly workspaceReservationId: string;
  readonly sequence: number;
  readonly publicDiscountId: string;
  readonly label: string;
  readonly subtotalBeforeValue: number;
  readonly subtotalBeforeExponent: number;
  readonly subtotalBeforeCurrency: string;
  readonly appliedAmountValue: number;
  readonly appliedAmountExponent: number;
  readonly appliedAmountCurrency: string;
  readonly subtotalAfterValue: number;
  readonly subtotalAfterExponent: number;
  readonly subtotalAfterCurrency: string;
  readonly createdAt: string | null;
};

/**
 * Metadata of one invoice provably issued to the customer. The encrypted
 * document bytes and the encryption key identifier are excluded.
 */
export type ExportedInvoice = {
  readonly invoiceNumber: string;
  readonly issuedAt: string | null;
  readonly numberingYear: number;
  readonly numberingSequence: number;
  readonly workspaceReservationId: string | null;
  readonly paymentAttemptId: string | null;
  readonly documentSnapshotRecordedAt: string | null;
};

/**
 * The customer-audience delivery status of one provably owned invoice.
 * Internal-audience deliveries and provider delivery identifiers are
 * excluded.
 */
export type ExportedInvoiceDelivery = {
  readonly invoiceNumber: string;
  readonly state: string;
  readonly createdAt: string | null;
  readonly acceptedAt: string | null;
};

/**
 * One legal-acceptance evidence event tied to one of the customer's own
 * reservations. Evidence events without a reservation link cannot be
 * attributed to this customer and are never exported.
 */
export type ExportedLegalEvidenceEvent = {
  readonly workspaceReservationId: string;
  readonly documentKey: string;
  readonly accepted: boolean;
  readonly acceptedAt: string | null;
  readonly locale: string;
  readonly source: string;
};

/**
 * One door-access grant's status and interval for the customer's own
 * reservation. The access code, the provider credential identifier, and the
 * device identifier are excluded by construction.
 */
export type ExportedAccessGrant = {
  readonly workspaceReservationId: string;
  readonly state: string;
  readonly scheduledAccessStartsAt: string | null;
  readonly accessStartsAt: string | null;
  readonly accessEndsAt: string | null;
  readonly issuedAt: string | null;
};

/**
 * One late-payment recovery's customer-relevant outcome for the customer's
 * own reservation: its state and completion timeline. Webhook and provider
 * identifiers are excluded.
 */
export type ExportedLatePaymentRecovery = {
  readonly workspaceReservationId: string;
  readonly state: string;
  readonly verifiedPaidAt: string | null;
  readonly completedAt: string | null;
};

export type CustomerExportRecords = {
  readonly reservations: readonly ExportedWorkspaceReservation[];
  readonly payments: readonly ExportedPaymentAttempt[];
  readonly discountApplications: readonly ExportedDiscountApplication[];
  readonly invoices: readonly ExportedInvoice[];
  readonly invoiceDeliveries: readonly ExportedInvoiceDelivery[];
  readonly legalEvidenceEvents: readonly ExportedLegalEvidenceEvent[];
  readonly accessGrants: readonly ExportedAccessGrant[];
  readonly latePaymentRecoveries: readonly ExportedLatePaymentRecovery[];
};

const instantText = (value: Temporal.Instant | null) =>
  value == null ? null : value.toString();

export type AccountDataExportRecordsError =
  | EffectDrizzleQueryError
  | SqlError
  | AccountDataExportRecordBoundExceededError;

/**
 * One per-customer read exceeded its documented upper bound. The load fails
 * closed before any archive section is assembled — the same outcome as an
 * over-limit archive — and the customer is routed to the full manual access
 * path. Bounds are per-customer-scope guards, never a substitute for the
 * customer-scoping `where` clause.
 */
export class AccountDataExportRecordBoundExceededError extends Data.TaggedError(
  "AccountDataExportRecordBoundExceededError"
)<{
  readonly section: string;
  readonly bound: number;
}> {}

/**
 * The documented per-customer upper bound for each export read. Each query
 * fetches at most `bound + 1` rows; the extra sentinel row proves an
 * overflow and fails the whole export closed instead of silently dropping
 * records. The bounds are generous — far above any typical data shape for
 * one customer — but a customer with an unusually long history can
 * legitimately exceed one. When a sentinel trips, the export fails closed
 * (no truncation, no partial archive) and the customer is directed to the
 * full manual access request.
 */
export const accountDataExportRecordBounds = {
  reservations: 500,
  payments: 2000,
  discountApplications: 2000,
  invoices: 500,
  invoiceDeliveries: 500,
  legalEvidenceEvents: 2000,
  accessGrants: 500,
  latePaymentRecoveries: 500,
} as const;

const boundedOrFail = <Row>(
  section: string,
  bound: number,
  rows: readonly Row[]
): Effect.Effect<readonly Row[], AccountDataExportRecordBoundExceededError> =>
  rows.length > bound
    ? Effect.fail(
        new AccountDataExportRecordBoundExceededError({ bound, section })
      )
    : Effect.succeed(rows.slice(0, bound));

interface IAccountDataExportRecordsRepository {
  readonly loadCustomerRecords: (
    dotyposCustomerId: DotyposCustomerId
  ) => Effect.Effect<CustomerExportRecords, AccountDataExportRecordsError>;
}

/**
 * Reads every first-party record the export attributes to one customer.
 * Every query is scoped through the customer-owned key — either the
 * reservation's `dotyposCustomerId` or the invoice's own
 * `dotyposCustomerId` column — so a record that cannot be attributed to the
 * verified customer through an existing join never leaves this boundary.
 */
export class AccountDataExportRecordsRepository extends Context.Service<
  AccountDataExportRecordsRepository,
  IAccountDataExportRecordsRepository
>()("@deskohub-workspace/account/AccountDataExportRecordsRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const loadCustomerRecords = Effect.fn(
        "AccountDataExportRecordsRepository.loadCustomerRecords"
      )(function* (dotyposCustomerId: DotyposCustomerId) {
        const reservationRowsSentinel = yield* db
          .select({
            workspaceReservationId: workspaceReservations.id,
            dotyposReservationId: workspaceReservations.dotyposReservationId,
            reservationPurpose: workspaceReservations.reservationPurpose,
            reservationState: workspaceReservations.reservationState,
            paymentState: workspaceReservations.paymentState,
            fulfillmentState: workspaceReservations.fulfillmentState,
            locale: workspaceReservations.locale,
            reservationCreatedAt: workspaceReservations.reservationCreatedAt,
            reservationConfirmedAt:
              workspaceReservations.reservationConfirmedAt,
            reservationCancelledAt:
              workspaceReservations.reservationCancelledAt,
            paidAt: workspaceReservations.paidAt,
            fulfilledAt: workspaceReservations.fulfilledAt,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId))
          .orderBy(workspaceReservations.reservationCreatedAt)
          .limit(accountDataExportRecordBounds.reservations + 1);

        // A sentinel row past the documented bound fails the whole export
        // closed — no truncation, no partial archive; the customer is routed
        // to the full manual access request.
        const reservationRows = yield* boundedOrFail(
          "workspace-reservations.json",
          accountDataExportRecordBounds.reservations,
          reservationRowsSentinel
        );

        const paymentRowsSentinel = yield* db
          .select({
            workspaceReservationId: paymentAttempts.workspaceReservationId,
            provider: paymentAttempts.provider,
            state: paymentAttempts.state,
            refundState: paymentAttempts.refundState,
            amountValue: paymentAttempts.amountValue,
            amountExponent: paymentAttempts.amountExponent,
            currency: paymentAttempts.currency,
            createdAt: paymentAttempts.createdAt,
            updatedAt: paymentAttempts.updatedAt,
          })
          .from(paymentAttempts)
          .innerJoin(
            workspaceReservations,
            eq(paymentAttempts.workspaceReservationId, workspaceReservations.id)
          )
          .where(eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId))
          .orderBy(paymentAttempts.createdAt)
          .limit(accountDataExportRecordBounds.payments + 1);

        // A sentinel row past the documented bound fails the whole export
        // closed — no truncation, no partial archive; the customer is routed
        // to the full manual access request.
        const paymentRows = yield* boundedOrFail(
          "payments.json",
          accountDataExportRecordBounds.payments,
          paymentRowsSentinel
        );

        const discountRowsSentinel = yield* db
          .select({
            workspaceReservationId: discountApplications.workspaceReservationId,
            sequence: discountApplications.sequence,
            publicDiscountId: discountApplications.publicDiscountId,
            label: discountApplications.label,
            subtotalBeforeValue: discountApplications.subtotalBeforeValue,
            subtotalBeforeExponent: discountApplications.subtotalBeforeExponent,
            subtotalBeforeCurrency: discountApplications.subtotalBeforeCurrency,
            appliedAmountValue: discountApplications.appliedAmountValue,
            appliedAmountExponent: discountApplications.appliedAmountExponent,
            appliedAmountCurrency: discountApplications.appliedAmountCurrency,
            subtotalAfterValue: discountApplications.subtotalAfterValue,
            subtotalAfterExponent: discountApplications.subtotalAfterExponent,
            subtotalAfterCurrency: discountApplications.subtotalAfterCurrency,
            createdAt: discountApplications.createdAt,
          })
          .from(discountApplications)
          .innerJoin(
            workspaceReservations,
            eq(
              discountApplications.workspaceReservationId,
              workspaceReservations.id
            )
          )
          .where(eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId))
          .orderBy(discountApplications.createdAt)
          .limit(accountDataExportRecordBounds.discountApplications + 1);

        // A sentinel row past the documented bound fails the whole export
        // closed — no truncation, no partial archive; the customer is routed
        // to the full manual access request.
        const discountRows = yield* boundedOrFail(
          "discount-applications.json",
          accountDataExportRecordBounds.discountApplications,
          discountRowsSentinel
        );

        // An invoice carries its own `dotyposCustomerId` column, so the
        // metadata is provably the customer's. The optional accounting
        // document snapshot is joined through the invoice's payment attempt,
        // which itself must belong to one of the customer's reservations;
        // only its recording time is exported, never the encrypted bytes.
        const invoiceRowsSentinel = yield* db
          .select({
            invoiceNumber: invoices.invoiceNumber,
            issuedAt: invoices.issuedAt,
            numberingYear: invoices.numberingYear,
            numberingSequence: invoices.numberingSequence,
            workspaceReservationId: invoices.workspaceReservationId,
            paymentAttemptId: invoices.paymentAttemptId,
            documentSnapshotRecordedAt: accountingDocumentSnapshots.createdAt,
          })
          .from(invoices)
          .leftJoin(
            accountingDocumentSnapshots,
            eq(
              accountingDocumentSnapshots.paymentAttemptId,
              invoices.paymentAttemptId
            )
          )
          .where(eq(invoices.dotyposCustomerId, dotyposCustomerId))
          .orderBy(invoices.issuedAt)
          .limit(accountDataExportRecordBounds.invoices + 1);

        // A sentinel row past the documented bound fails the whole export
        // closed — no truncation, no partial archive; the customer is routed
        // to the full manual access request.
        const invoiceRows = yield* boundedOrFail(
          "invoices.json",
          accountDataExportRecordBounds.invoices,
          invoiceRowsSentinel
        );

        const deliveryRowsSentinel = yield* db
          .select({
            invoiceNumber: invoices.invoiceNumber,
            state: invoiceEmailDeliveries.state,
            createdAt: invoiceEmailDeliveries.createdAt,
            acceptedAt: invoiceEmailDeliveries.acceptedAt,
          })
          .from(invoiceEmailDeliveries)
          .innerJoin(
            invoices,
            eq(invoiceEmailDeliveries.invoiceId, invoices.id)
          )
          .where(
            and(
              eq(invoices.dotyposCustomerId, dotyposCustomerId),
              // Internal-audience delivery records are the operator's mail,
              // not the customer's data.
              eq(invoiceEmailDeliveries.audience, "customer")
            )
          )
          .orderBy(invoiceEmailDeliveries.createdAt)
          .limit(accountDataExportRecordBounds.invoiceDeliveries + 1);

        // A sentinel row past the documented bound fails the whole export
        // closed — no truncation, no partial archive; the customer is routed
        // to the full manual access request.
        const deliveryRows = yield* boundedOrFail(
          "invoices.json",
          accountDataExportRecordBounds.invoiceDeliveries,
          deliveryRowsSentinel
        );

        const legalEvidenceRowsSentinel = yield* db
          .select({
            workspaceReservationId: legalEvidenceEvents.workspaceReservationId,
            documentKey: legalEvidenceEvents.documentKey,
            accepted: legalEvidenceEvents.accepted,
            acceptedAt: legalEvidenceEvents.acceptedAt,
            locale: legalEvidenceEvents.locale,
            source: legalEvidenceEvents.source,
          })
          .from(legalEvidenceEvents)
          .innerJoin(
            workspaceReservations,
            eq(
              legalEvidenceEvents.workspaceReservationId,
              workspaceReservations.id
            )
          )
          .where(eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId))
          .orderBy(legalEvidenceEvents.acceptedAt)
          .limit(accountDataExportRecordBounds.legalEvidenceEvents + 1);

        // A sentinel row past the documented bound fails the whole export
        // closed — no truncation, no partial archive; the customer is routed
        // to the full manual access request.
        const legalEvidenceRows = yield* boundedOrFail(
          "consents.json",
          accountDataExportRecordBounds.legalEvidenceEvents,
          legalEvidenceRowsSentinel
        );

        const grantRowsSentinel = yield* db
          .select({
            workspaceReservationId:
              reservationAccessGrants.workspaceReservationId,
            state: reservationAccessGrants.state,
            scheduledAccessStartsAt:
              reservationAccessGrants.scheduledAccessStartsAt,
            accessStartsAt: reservationAccessGrants.accessStartsAt,
            accessEndsAt: reservationAccessGrants.accessEndsAt,
            issuedAt: reservationAccessGrants.issuedAt,
          })
          .from(reservationAccessGrants)
          .innerJoin(
            workspaceReservations,
            eq(
              reservationAccessGrants.workspaceReservationId,
              workspaceReservations.id
            )
          )
          .where(eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId))
          .orderBy(reservationAccessGrants.accessStartsAt)
          .limit(accountDataExportRecordBounds.accessGrants + 1);

        // A sentinel row past the documented bound fails the whole export
        // closed — no truncation, no partial archive; the customer is routed
        // to the full manual access request.
        const grantRows = yield* boundedOrFail(
          "access-grants.json",
          accountDataExportRecordBounds.accessGrants,
          grantRowsSentinel
        );

        const recoveryRowsSentinel = yield* db
          .select({
            workspaceReservationId:
              latePaymentRecoveries.workspaceReservationId,
            state: latePaymentRecoveries.state,
            verifiedPaidAt: latePaymentRecoveries.verifiedPaidAt,
            completedAt: latePaymentRecoveries.completedAt,
          })
          .from(latePaymentRecoveries)
          .innerJoin(
            workspaceReservations,
            eq(
              latePaymentRecoveries.workspaceReservationId,
              workspaceReservations.id
            )
          )
          .where(eq(workspaceReservations.dotyposCustomerId, dotyposCustomerId))
          .orderBy(latePaymentRecoveries.verifiedPaidAt)
          .limit(accountDataExportRecordBounds.latePaymentRecoveries + 1);

        // A sentinel row past the documented bound fails the whole export
        // closed — no truncation, no partial archive; the customer is routed
        // to the full manual access request.
        const recoveryRows = yield* boundedOrFail(
          "payments.json",
          accountDataExportRecordBounds.latePaymentRecoveries,
          recoveryRowsSentinel
        );

        return {
          reservations: reservationRows.map((row) => ({
            ...row,
            reservationCreatedAt: instantText(row.reservationCreatedAt),
            reservationConfirmedAt: instantText(row.reservationConfirmedAt),
            reservationCancelledAt: instantText(row.reservationCancelledAt),
            paidAt: instantText(row.paidAt),
            fulfilledAt: instantText(row.fulfilledAt),
          })),
          payments: paymentRows.map((row) => ({
            ...row,
            createdAt: instantText(row.createdAt),
            updatedAt: instantText(row.updatedAt),
          })),
          discountApplications: discountRows.map((row) => ({
            ...row,
            createdAt: instantText(row.createdAt),
          })),
          invoices: invoiceRows.map((row) => ({
            ...row,
            issuedAt: instantText(row.issuedAt),
            documentSnapshotRecordedAt: instantText(
              row.documentSnapshotRecordedAt
            ),
          })),
          invoiceDeliveries: deliveryRows.map((row) => ({
            ...row,
            createdAt: instantText(row.createdAt),
            acceptedAt: instantText(row.acceptedAt),
          })),
          legalEvidenceEvents: legalEvidenceRows.flatMap((row) =>
            // The inner join already guarantees a reservation link; the
            // explicit skip keeps the projection honest if that ever drifts.
            row.workspaceReservationId == null
              ? []
              : [
                  {
                    ...row,
                    workspaceReservationId: row.workspaceReservationId,
                    acceptedAt: instantText(row.acceptedAt),
                  },
                ]
          ),
          accessGrants: grantRows.map((row) => ({
            ...row,
            scheduledAccessStartsAt: instantText(row.scheduledAccessStartsAt),
            accessStartsAt: instantText(row.accessStartsAt),
            accessEndsAt: instantText(row.accessEndsAt),
            issuedAt: instantText(row.issuedAt),
          })),
          latePaymentRecoveries: recoveryRows.map((row) => ({
            ...row,
            verifiedPaidAt: instantText(row.verifiedPaidAt),
            completedAt: instantText(row.completedAt),
          })),
        } satisfies CustomerExportRecords;
      });

      return {
        loadCustomerRecords,
      } satisfies IAccountDataExportRecordsRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
