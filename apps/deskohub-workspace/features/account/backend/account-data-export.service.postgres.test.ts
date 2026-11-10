import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import {
  AlgoPinSchema,
  IgloohomeDeviceIdSchema,
  IgloohomePinIdSchema,
} from "@deskohub/igloohome";
import {
  NexiOperationIdSchema,
  NexiOrderIdSchema,
  NexiWebhookEventIdSchema,
} from "@deskohub/nexi";
import { NodeCrypto } from "@effect/platform-node";
import { eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { unzipSync } from "fflate";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  accountingDocumentSnapshots,
  customerMarketingConsents,
  discountApplications,
  invoiceEmailDeliveries,
  invoices,
  latePaymentRecoveries,
  legalEvidenceEvents,
  paymentAttempts,
  reservationAccessGrants,
  workspaceReservations,
} from "@/db/schema";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { InvoiceEmailDeliveryRepository } from "@/features/accounting/backend/invoice-email-delivery.repository";
import { invoiceNumberSchema } from "@/features/accounting/invoice";
import { DiscountApplicationRepository } from "@/features/checkout/backend/repositories/discount-application.repository";
import { LatePaymentRecoveryRepository } from "@/features/checkout/backend/repositories/late-payment-recovery.repository";
import { LegalEvidenceEventRepository } from "@/features/checkout/backend/repositories/legal-evidence-event.repository";
import { PaymentAttemptRepository } from "@/features/checkout/backend/repositories/payment-attempt.repository";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import { discountIdSchema } from "@/features/discounts/contracts";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { CustomerBookedReservations } from "@/features/reservation/backend/customer-booked-reservations";
import { countedDotyposReservationReads } from "@/features/reservation/backend/reservation-visits.test-utils";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { ReservationAccessRepository } from "@/features/reservation-access/backend/reservation-access.repository";
import { ReviewAccounts } from "@/features/review-accounts";
import {
  syntheticDotyposCustomerId,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { CustomerAccountId } from "../customer-account";
import {
  type AccountDataExportFailureCode,
  AccountDataExportLimits,
  AccountDataExportService,
} from "./account-data-export.service";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAccountResolver } from "./customer-account-resolver.service";
import { CustomerAccountSections } from "./customer-account-sections";
import { signedInAuthentication } from "./customer-authentication.test-utils";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";

// Invoice numbers and their yearly sequence are unique across the database,
// so the suite issues its invoices into a database of its own.
const postgres = await createWorkspacePostgresSuiteDatabase(
  "account_data_export"
);
afterAll(() => postgres?.close());

/** Dotypos as the export reads it: one in-memory list, filtered by customer. */
const dotypos = countedDotyposReservationReads([]);

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const database = () => postgres!.db;

/**
 * Every value seeded into a column the export must never select: tokens,
 * provider ids and redirect URLs, access codes, device ids, key ids,
 * encrypted bytes, failure codes, and internal JSON.
 */
const sensitiveValues: string[] = [];
const sensitive = (label: string) => {
  const value = `sensitive-${label}-${crypto.randomUUID()}`;
  sensitiveValues.push(value);
  return value;
};
const sensitiveDigits = () => {
  const value = String(100_000_000 + Math.floor(Math.random() * 899_999_999));
  sensitiveValues.push(value);
  return value;
};
const sensitiveKeyId = () => {
  const value = `SENSITIVE_${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
  sensitiveValues.push(value);
  return accountingSnapshotKeyIdSchema.make(value);
};

const sha256Hex = () =>
  crypto.randomUUID().replaceAll("-", "").repeat(2).slice(0, 64);

const at = (instant: string) => Temporal.Instant.from(instant);
const issuedAt = at("2026-08-01T08:07:00Z");
let invoiceSequence = 0;

type SeededCustomer = {
  readonly customerId: DotyposCustomerId;
  readonly accountId: CustomerAccountId;
};

type SeededReservation = {
  readonly id: WorkspaceReservationId;
  readonly dotyposReservationId: DotyposReservationId;
};

/** A verified login linked to a fresh Dotypos customer. */
const seedCustomer = async (label: string): Promise<SeededCustomer> => {
  const customerId = syntheticDotyposCustomerId(`export-${label}`);
  const { accountId } = await run(
    workspaceFixtures(database()).account(`export-${label}`, {
      linkedCustomer: customerId,
    })
  );
  return { customerId, accountId };
};

/**
 * A paid, fulfilled Workspace reservation made for `customer`, authored by
 * `author` (the customer's own account by default), that Dotypos also holds
 * for that customer unless `inDotypos` is false.
 */
const seedReservation = async (
  customer: SeededCustomer,
  {
    author = customer.accountId,
    inDotypos = true,
  }: { readonly author?: CustomerAccountId; readonly inDotypos?: boolean } = {}
): Promise<SeededReservation> => {
  const row = await run(
    workspaceFixtures(database()).reservation({
      stage: {
        reservation: "confirmed",
        payment: "paid",
        fulfillment: "fulfilled",
      },
      customer: customer.customerId,
      author,
    })
  );
  const dotyposReservationId = DotyposReservationIdSchema.make(
    row.dotyposReservationId!
  );
  if (inDotypos)
    addDotyposReservation(customer.customerId, dotyposReservationId);
  return { id: row.id, dotyposReservationId };
};

const firstStart = at("2026-09-01T07:00:00Z");

/** A reservation Dotypos holds for the customer, without a Workspace record unless one names it. */
const addDotyposReservation = (
  customerId: DotyposCustomerId,
  id: DotyposReservationId = DotyposReservationIdSchema.make(
    `export-desk-${crypto.randomUUID()}`
  )
) => {
  const startsAt = firstStart.add({ hours: dotypos.reservations.size });
  const reservation: DotyposReservation = {
    id,
    _branchId: "branch",
    _cloudId: "cloud",
    _customerId: customerId,
    _tableId: "table",
    startDate: startsAt.toString(),
    endDate: startsAt.add({ hours: 8 }).toString(),
    seats: "1",
    status: "CONFIRMED",
    note: sensitive("dotypos-note"),
  };
  dotypos.reservations.set(id, reservation);
  return id;
};

const seedPayment = async (
  reservationId: WorkspaceReservationId,
  { refunded = false }: { readonly refunded?: boolean } = {}
): Promise<PaymentAttemptId> => {
  const refund = refunded
    ? ({
        refundState: "refunded",
        refundedAmountValue: 5000,
        refundedAt: at("2026-08-03T10:00:00Z"),
      } as const)
    : ({
        refundState: "not_required",
        refundedAmountValue: null,
        refundedAt: null,
      } as const);
  const [row] = await run(
    database()
      .insert(paymentAttempts)
      .values({
        workspaceReservationId: reservationId,
        provider: "nexi",
        providerOrderId: NexiOrderIdSchema.make(sensitive("order")),
        securityToken: sensitive("security-token"),
        providerRedirectUrl: `https://pay.example.test/${sensitive("redirect")}`,
        lastWebhookEventId: NexiWebhookEventIdSchema.make(sensitive("webhook")),
        lastProviderOperationId: NexiOperationIdSchema.make(
          sensitive("operation")
        ),
        lastProviderStatus: sensitive("provider-status"),
        state: "paid",
        amountValue: 45_050,
        amountExponent: 2,
        currency: "CZK",
        ...refund,
      })
      .returning({ id: paymentAttempts.id })
  );
  return row!.id;
};

const seedLatePaymentRecovery = (
  reservationId: WorkspaceReservationId,
  paymentAttemptId: PaymentAttemptId
) =>
  run(
    database()
      .insert(latePaymentRecoveries)
      .values({
        paymentAttemptId,
        workspaceReservationId: reservationId,
        webhookEventId: NexiWebhookEventIdSchema.make(sensitive("webhook")),
        providerOperationId: NexiOperationIdSchema.make(sensitive("operation")),
        providerStatus: sensitive("provider-status"),
        state: "review_required",
        originalDotyposReservationId: DotyposReservationIdSchema.make(
          `export-original-${crypto.randomUUID()}`
        ),
        failureCode: sensitive("failure-code"),
        verifiedPaidAt: at("2026-08-01T08:04:00Z"),
        completedAt: at("2026-08-01T08:09:00Z"),
      })
  );

const seedDiscountApplication = async (
  reservationId: WorkspaceReservationId,
  paymentAttemptId: PaymentAttemptId,
  sequence: number
) => {
  const publicDiscountId = discountIdSchema.make(
    `export-discount-${crypto.randomUUID()}`
  );
  await run(
    database()
      .insert(discountApplications)
      .values({
        paymentAttemptId,
        workspaceReservationId: reservationId,
        sequence,
        publicDiscountId,
        label: "Synthetic discount",
        // Staff-facing only: the customer's export keeps the guest label.
        staffLabel: sensitive("staff-label"),
        adjustment: { internal: sensitive("adjustment") },
        productIdentity: { internal: sensitive("product-identity") },
        provenance: { internal: sensitive("provenance") },
        subtotalBeforeValue: 50_050,
        subtotalBeforeExponent: 2,
        subtotalBeforeCurrency: "CZK",
        appliedAmountValue: 5000,
        appliedAmountExponent: 2,
        appliedAmountCurrency: "CZK",
        subtotalAfterValue: 45_050,
        subtotalAfterExponent: 2,
        subtotalAfterCurrency: "CZK",
      })
  );
  return publicDiscountId;
};

const seedLegalEvidenceEvent = async (
  reservationId: WorkspaceReservationId | null
) => {
  const documentHash = sha256Hex();
  await run(
    database()
      .insert(legalEvidenceEvents)
      .values({
        workspaceReservationId: reservationId,
        documentKey: "terms",
        documentPath: "/en-US/terms",
        documentHash,
        hashAlgorithm: "sha256",
        accepted: true,
        acceptedAt: at("2026-08-01T08:00:30Z"),
        locale: "en-US",
        source: "reservation_form",
        acknowledgements: { earlyPerformanceConsent: true },
      })
  );
  return documentHash;
};

const seedAccessGrant = (reservationId: WorkspaceReservationId) =>
  run(
    database()
      .insert(reservationAccessGrants)
      .values({
        workspaceReservationId: reservationId,
        deviceId: IgloohomeDeviceIdSchema.make(sensitive("device")),
        state: "issued",
        providerCredentialId: IgloohomePinIdSchema.make(sensitive("pin")),
        accessCode: AlgoPinSchema.make(sensitiveDigits()),
        accessName: sensitive("access-name"),
        scheduledAccessStartsAt: at("2026-09-01T07:00:00Z"),
        accessStartsAt: at("2026-09-01T06:45:00Z"),
        accessEndsAt: at("2026-09-01T15:15:00Z"),
        issuedAt: at("2026-09-01T06:30:00Z"),
      })
  );

/**
 * An invoice for the customer with a customer delivery the provider
 * accepted and an internal delivery still processing. With a reservation, the
 * invoice is that reservation's, issued from its payment's accounting
 * snapshot.
 */
const seedInvoice = async (
  customerId: DotyposCustomerId,
  source?: {
    readonly reservationId: WorkspaceReservationId;
    readonly paymentAttemptId: PaymentAttemptId;
  }
) => {
  invoiceSequence += 1;
  const invoiceNumber = invoiceNumberSchema.make(
    `WS-FV-2026-${String(invoiceSequence).padStart(6, "0")}`
  );
  if (source) {
    await run(
      database()
        .insert(accountingDocumentSnapshots)
        .values({
          paymentAttemptId: source.paymentAttemptId,
          workspaceReservationId: source.reservationId,
          keyId: sensitiveKeyId(),
          encryptedSnapshot: Buffer.from(sensitive("snapshot")),
        })
    );
  }
  const [invoice] = await run(
    database()
      .insert(invoices)
      .values({
        workspaceReservationId: source?.reservationId ?? null,
        paymentAttemptId: source?.paymentAttemptId ?? null,
        dotyposCustomerId: customerId,
        invoiceNumber,
        numberingYear: 2026,
        numberingSequence: invoiceSequence,
        keyId: sensitiveKeyId(),
        encryptedDocument: Buffer.from(sensitive("document")),
        issuedAt,
      })
      .returning({ id: invoices.id })
  );
  await run(
    database()
      .insert(invoiceEmailDeliveries)
      .values([
        {
          invoiceId: invoice!.id,
          audience: "customer",
          state: "accepted",
          attemptCount: 1,
          providerDeliveryId: EmailDeliveryIdSchema.make(sensitive("delivery")),
          acceptedAt: issuedAt.add({ seconds: 30 }),
        },
        {
          invoiceId: invoice!.id,
          audience: "internal",
          state: "processing",
          attemptCount: 1,
        },
      ])
  );
  return invoiceNumber;
};

const seedMarketingConsent = async (customerId: DotyposCustomerId) => {
  const documentHash = sha256Hex();
  await run(
    database()
      .insert(customerMarketingConsents)
      .values({
        dotyposCustomerId: customerId,
        documentHash,
        locale: "en-US",
        grantedAt: at("2026-07-01T09:00:00Z"),
        grantSource: "account",
      })
  );
  return documentHash;
};

/** The identifiers one reservation's rows in every section carry. */
type SeededReservationRecords = SeededReservation & {
  readonly paymentAttemptId: PaymentAttemptId;
  readonly publicDiscountId: string;
  readonly legalDocumentHash: string;
  readonly invoiceNumber: string;
};

/**
 * A reservation made for `customer` by `author` with a row in every
 * reservation-keyed section and an invoice issued from its payment.
 */
const seedReservationWithEverySection = async (
  customer: SeededCustomer,
  author?: CustomerAccountId
): Promise<SeededReservationRecords> => {
  const reservation = await seedReservation(customer, { author });
  const paymentAttemptId = await seedPayment(reservation.id, {
    refunded: true,
  });
  // An invoice is issued from the reservation's active paid attempt.
  await run(
    database()
      .update(workspaceReservations)
      .set({ activePaymentAttemptId: paymentAttemptId })
      .where(eq(workspaceReservations.id, reservation.id))
  );
  await seedLatePaymentRecovery(reservation.id, paymentAttemptId);
  const publicDiscountId = await seedDiscountApplication(
    reservation.id,
    paymentAttemptId,
    0
  );
  const legalDocumentHash = await seedLegalEvidenceEvent(reservation.id);
  await seedAccessGrant(reservation.id);
  const invoiceNumber = await seedInvoice(customer.customerId, {
    reservationId: reservation.id,
    paymentAttemptId,
  });
  return {
    ...reservation,
    paymentAttemptId,
    publicDiscountId,
    legalDocumentHash,
    invoiceNumber,
  };
};

const reservationIdentifiers = (reservation: SeededReservationRecords) => [
  reservation.id,
  reservation.dotyposReservationId,
  reservation.paymentAttemptId,
  reservation.publicDiscountId,
  reservation.legalDocumentHash,
  reservation.invoiceNumber,
];

const roomyLimits: AccountDataExportLimits = {
  reservations: 50,
  payments: 50,
  latePaymentRecoveries: 50,
  discountApplications: 50,
  invoices: 50,
  invoiceDeliveries: 50,
  legalEvidenceEvents: 50,
  accessGrants: 50,
};

const syntheticProfile = {
  firstName: "Ada",
  lastName: "Synthetic",
  phone: null,
  billing: null,
};

/**
 * The live export over the suite's database with every owner's real reader.
 * Only the session (signed in as the customer's account), the Dotypos profile
 * read, and Dotypos itself (in memory) are faked.
 */
const exportService = (
  customer: SeededCustomer,
  limits: AccountDataExportLimits
) => {
  const storage = Layer.mergeAll(
    postgres!.layer,
    WorkspaceDatabaseAdvisoryLock.makeLayer(postgres!.pool),
    AccountingSnapshotKeyService.Default,
    NodeCrypto.layer
  );
  const owners = Layer.mergeAll(
    CustomerAccountLinkRepository.Default,
    ReviewAccounts.Default,
    WorkspaceReservationRepository.Default,
    CustomerBookedReservations.Provider.pipe(Layer.provide(dotypos.layer)),
    PaymentAttemptRepository.Default,
    LatePaymentRecoveryRepository.Default,
    DiscountApplicationRepository.Default,
    LegalEvidenceEventRepository.Default,
    InvoiceRepository.Default.pipe(
      Layer.provide(AccountingDocumentSnapshotRepository.Default)
    ),
    InvoiceEmailDeliveryRepository.Default,
    MarketingConsentLedger.Default,
    ReservationAccessRepository.Default
  ).pipe(Layer.provideMerge(storage));
  const session = Layer.mergeAll(
    signedInAuthentication(customer.accountId),
    Layer.mock(CustomerDotyposAdapter, {
      readCustomerProfile: () => Effect.succeed(syntheticProfile),
    })
  );
  return AccountDataExportService.Default.pipe(
    Layer.provide(CustomerAccountResolver.Default),
    Layer.provide(CustomerAccountSections.Default),
    Layer.provide(
      Layer.mergeAll(
        session,
        owners,
        Layer.succeed(AccountDataExportLimits, limits)
      )
    )
  );
};

const downloadFor = (
  customer: SeededCustomer,
  limits: AccountDataExportLimits = roomyLimits
) =>
  run(
    Effect.flatMap(
      AccountDataExportService,
      (service) => service.download
    ).pipe(Effect.provide(exportService(customer, limits)))
  );

const failureFor = (
  customer: SeededCustomer,
  limits: AccountDataExportLimits
) =>
  run(
    Effect.flatMap(
      AccountDataExportService,
      (service) => service.download
    ).pipe(Effect.flip, Effect.provide(exportService(customer, limits)))
  );

/** One JSON object of a section, keeping every key the archive wrote. */
const ArchiveRow = Schema.Record(Schema.String, Schema.Json);
type ArchiveRow = typeof ArchiveRow.Type;
const ArchiveRows = Schema.Array(ArchiveRow);

/**
 * Each section file's JSON. Excess keys fail the decode, so a section can't
 * carry a field this suite doesn't see.
 */
const ArchiveFiles = {
  "identity.json": ArchiveRow,
  "dotypos-profile.json": ArchiveRow,
  "reservation-history.json": ArchiveRows,
  "workspace-reservations.json": ArchiveRows,
  "payments.json": Schema.Struct({
    payments: ArchiveRows,
    latePaymentRecoveries: ArchiveRows,
  }),
  "discount-applications.json": ArchiveRows,
  "invoices.json": Schema.Struct({
    invoices: ArchiveRows,
    customerEmailDeliveries: ArchiveRows,
  }),
  "consents.json": Schema.Struct({
    marketingConsent: Schema.NullOr(ArchiveRow),
    legalEvidenceEvents: ArchiveRows,
  }),
  "access-grants.json": Schema.Struct({ accessGrants: ArchiveRows }),
};

/** The archive's sections as JSON, and all of its text. */
const archiveFor = async (
  customer: SeededCustomer,
  limits: AccountDataExportLimits = roomyLimits
) => {
  const { bytes } = await downloadFor(customer, limits);
  const files = unzipSync(bytes);
  const decoder = new TextDecoder();
  const text = (path: string) => decoder.decode(files[path]);
  const section = <Path extends keyof typeof ArchiveFiles>(path: Path) =>
    Schema.decodeUnknownSync(Schema.fromJsonString(ArchiveFiles[path]), {
      onExcessProperty: "error",
    })(text(path));
  const payments = section("payments.json");
  const invoiceSection = section("invoices.json");
  const consents = section("consents.json");
  return {
    text: Object.keys(files).map(text).join("\n"),
    identity: section("identity.json"),
    profile: section("dotypos-profile.json"),
    reservationHistory: section("reservation-history.json"),
    workspaceReservations: section("workspace-reservations.json"),
    payments: payments.payments,
    latePaymentRecoveries: payments.latePaymentRecoveries,
    discountApplications: section("discount-applications.json"),
    invoices: invoiceSection.invoices,
    invoiceDeliveries: invoiceSection.customerEmailDeliveries,
    marketingConsent: consents.marketingConsent,
    legalEvidenceEvents: consents.legalEvidenceEvents,
    accessGrants: section("access-grants.json").accessGrants,
  };
};

type Archive = Awaited<ReturnType<typeof archiveFor>>;

/** A JSON object's keys in order; anything but an object fails the test. */
const keysOf = (value: Schema.Json | undefined) =>
  Object.keys(Schema.decodeUnknownSync(ArchiveRow)(value)).sort();
const valuesOf = (list: readonly ArchiveRow[], key: string) =>
  list.map((row) => row[key]).sort();
const moneyKeys = ["currency", "exponent", "value"];

describe.skipIf(!postgres)("account data export over Postgres", () => {
  describe("two customers with rows in every section", () => {
    let a: SeededCustomer;
    let b: SeededCustomer;
    let aReservations: SeededReservationRecords[];
    let bReservation: SeededReservationRecords;
    /** Made for customer B by customer A's account. */
    let authoredForB: SeededReservationRecords;
    let aDeskReservation: DotyposReservationId;
    let aInvoiceNumbers: string[];
    let bIdentifiers: string[];
    let unattributedDocumentHash: string;
    let aArchive: Archive;
    let bArchive: Archive;

    beforeAll(async () => {
      if (!postgres) return;
      a = await seedCustomer("a");
      b = await seedCustomer("b");
      aReservations = [
        await seedReservationWithEverySection(a),
        await seedReservationWithEverySection(a),
      ];
      bReservation = await seedReservationWithEverySection(b);
      authoredForB = await seedReservationWithEverySection(b, a.accountId);
      aDeskReservation = addDotyposReservation(a.customerId);
      const bDeskReservation = addDotyposReservation(b.customerId);
      const aStandaloneInvoice = await seedInvoice(a.customerId);
      const bStandaloneInvoice = await seedInvoice(b.customerId);
      await seedMarketingConsent(a.customerId);
      const bConsentHash = await seedMarketingConsent(b.customerId);
      unattributedDocumentHash = await seedLegalEvidenceEvent(null);
      aInvoiceNumbers = [
        ...aReservations.map(({ invoiceNumber }) => invoiceNumber),
        aStandaloneInvoice,
      ];
      bIdentifiers = [
        b.accountId,
        b.customerId,
        ...reservationIdentifiers(bReservation),
        ...reservationIdentifiers(authoredForB),
        bDeskReservation,
        bStandaloneInvoice,
        bConsentHash,
      ];
      aArchive = await archiveFor(a);
      bArchive = await archiveFor(b);
    });

    test("holds none of another customer's rows", () => {
      expect(bIdentifiers.filter((id) => aArchive.text.includes(id))).toEqual(
        []
      );
      expect(aArchive.identity.accountId).toBe(a.accountId);
      expect(valuesOf(aArchive.workspaceReservations, "id")).toEqual(
        aReservations.map(({ id }) => id).sort()
      );
      expect(
        valuesOf(aArchive.reservationHistory, "dotyposReservationId")
      ).toEqual(
        [
          ...aReservations.map(
            ({ dotyposReservationId }) => dotyposReservationId
          ),
          aDeskReservation,
        ].sort()
      );
      const aReservationIds = aReservations.map(({ id }) => id).sort();
      for (const section of [
        aArchive.payments,
        aArchive.latePaymentRecoveries,
        aArchive.discountApplications,
        aArchive.legalEvidenceEvents,
        aArchive.accessGrants,
      ]) {
        expect(valuesOf(section, "workspaceReservationId")).toEqual(
          aReservationIds
        );
      }
      expect(valuesOf(aArchive.invoices, "invoiceNumber")).toEqual(
        [...aInvoiceNumbers].sort()
      );
      expect(aArchive.marketingConsent).not.toBeNull();
      const aIdentifiers = aReservations.flatMap(reservationIdentifiers);
      expect(aIdentifiers.filter((id) => bArchive.text.includes(id))).toEqual(
        []
      );
    });

    test("leaves a reservation the account made for another customer to that customer", () => {
      expect(
        reservationIdentifiers(authoredForB).filter((id) =>
          aArchive.text.includes(id)
        )
      ).toEqual([]);
      const bReservationIds = [bReservation.id, authoredForB.id].sort();
      expect(valuesOf(bArchive.workspaceReservations, "id")).toEqual(
        bReservationIds
      );
      for (const section of [
        bArchive.payments,
        bArchive.latePaymentRecoveries,
        bArchive.discountApplications,
        bArchive.legalEvidenceEvents,
        bArchive.accessGrants,
      ]) {
        expect(valuesOf(section, "workspaceReservationId")).toEqual(
          bReservationIds
        );
      }
      expect(
        valuesOf(bArchive.reservationHistory, "dotyposReservationId")
      ).toContain(authoredForB.dotyposReservationId);
      expect(valuesOf(bArchive.invoices, "invoiceNumber")).toContain(
        authoredForB.invoiceNumber
      );
    });

    test("lists only deliveries to the customer", () => {
      expect(valuesOf(aArchive.invoiceDeliveries, "invoiceNumber")).toEqual(
        [...aInvoiceNumbers].sort()
      );
      expect(valuesOf(aArchive.invoiceDeliveries, "state")).toEqual(
        aInvoiceNumbers.map(() => "accepted")
      );
    });

    test("leaves out legal evidence attributed to no reservation", () => {
      expect(aArchive.text.includes(unattributedDocumentHash)).toBe(false);
      expect(bArchive.text.includes(unattributedDocumentHash)).toBe(false);
      expect(valuesOf(aArchive.legalEvidenceEvents, "documentHash")).toEqual(
        aReservations.map(({ legalDocumentHash }) => legalDocumentHash).sort()
      );
    });

    test("projects each section to its allowlisted fields only", () => {
      expect(keysOf(aArchive.identity)).toEqual([
        "accountCreatedAt",
        "accountId",
        "accountUpdatedAt",
        "deletionRequested",
        "displayName",
        "email",
        "emailVerified",
      ]);
      expect(keysOf(aArchive.profile)).toEqual([
        "billing",
        "firstName",
        "lastName",
        "phone",
      ]);
      const sectionKeys = (list: readonly ArchiveRow[]) => [
        ...new Set(list.map((row) => keysOf(row).join(","))),
      ];
      expect(sectionKeys(aArchive.workspaceReservations)).toEqual([
        [
          "dotyposReservationId",
          "fulfilledAt",
          "fulfillmentState",
          "id",
          "locale",
          "paidAt",
          "paymentState",
          "product",
          "reservationCancelledAt",
          "reservationConfirmedAt",
          "reservationCreatedAt",
          "reservationPurpose",
          "reservationState",
        ].join(","),
      ]);
      expect(sectionKeys(aArchive.reservationHistory)).toEqual([
        [
          "dotyposReservationId",
          "heldFrom",
          "heldUntil",
          "product",
          "seats",
          "status",
        ].join(","),
      ]);
      expect(sectionKeys(aArchive.payments)).toEqual([
        [
          "amount",
          "createdAt",
          "provider",
          "refundState",
          "refundedAmount",
          "refundedAt",
          "state",
          "updatedAt",
          "workspaceReservationId",
        ].join(","),
      ]);
      for (const payment of aArchive.payments) {
        expect(keysOf(payment.amount)).toEqual(moneyKeys);
        expect(keysOf(payment.refundedAmount)).toEqual(moneyKeys);
      }
      expect(aArchive.payments[0]).toMatchObject({
        provider: "nexi",
        state: "paid",
        refundState: "refunded",
        amount: { value: 45_050, exponent: 2, currency: "CZK" },
        refundedAmount: { value: 5000, exponent: 2, currency: "CZK" },
      });
      expect(sectionKeys(aArchive.latePaymentRecoveries)).toEqual([
        [
          "completedAt",
          "state",
          "verifiedPaidAt",
          "workspaceReservationId",
        ].join(","),
      ]);
      expect(sectionKeys(aArchive.discountApplications)).toEqual([
        [
          "appliedAmount",
          "createdAt",
          "label",
          "publicDiscountId",
          "sequence",
          "subtotalAfter",
          "subtotalBefore",
          "workspaceReservationId",
        ].join(","),
      ]);
      for (const discount of aArchive.discountApplications) {
        for (const amount of [
          "subtotalBefore",
          "appliedAmount",
          "subtotalAfter",
        ])
          expect(keysOf(discount[amount])).toEqual(moneyKeys);
      }
      expect(sectionKeys(aArchive.invoices)).toEqual([
        [
          "documentSnapshotRecordedAt",
          "invoiceNumber",
          "issuedAt",
          "numberingSequence",
          "numberingYear",
          "paymentAttemptId",
          "workspaceReservationId",
        ].join(","),
      ]);
      expect(
        aArchive.invoices.filter(
          ({ documentSnapshotRecordedAt }) =>
            documentSnapshotRecordedAt !== null
        )
      ).toHaveLength(aReservations.length);
      expect(sectionKeys(aArchive.invoiceDeliveries)).toEqual([
        ["acceptedAt", "createdAt", "invoiceNumber", "state"].join(","),
      ]);
      expect(keysOf(aArchive.marketingConsent)).toEqual([
        "documentHash",
        "grantSource",
        "grantedAt",
        "locale",
        "withdrawnAt",
      ]);
      expect(sectionKeys(aArchive.legalEvidenceEvents)).toEqual([
        [
          "accepted",
          "acceptedAt",
          "documentHash",
          "documentKey",
          "documentPath",
          "earlyPerformanceConsent",
          "hashAlgorithm",
          "locale",
          "source",
          "workspaceReservationId",
        ].join(","),
      ]);
      expect(
        valuesOf(aArchive.legalEvidenceEvents, "earlyPerformanceConsent")
      ).toEqual(aReservations.map(() => true));
      expect(sectionKeys(aArchive.accessGrants)).toEqual([
        [
          "accessEndsAt",
          "accessStartsAt",
          "issuedAt",
          "scheduledAccessStartsAt",
          "state",
          "workspaceReservationId",
        ].join(","),
      ]);
      expect(
        sensitiveValues.filter(
          (value) =>
            aArchive.text.includes(value) || bArchive.text.includes(value)
        )
      ).toEqual([]);
    });

    test("gives a Dotypos reservation the product of its Workspace record, and none without one", () => {
      for (const reservation of aReservations) {
        const history = aArchive.reservationHistory.find(
          ({ dotyposReservationId }) =>
            dotyposReservationId === reservation.dotyposReservationId
        );
        const workspace = aArchive.workspaceReservations.find(
          ({ id }) => id === reservation.id
        );
        expect(history?.product).toEqual({
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        });
        expect(history?.product).toEqual(workspace?.product);
      }
      const desk = aArchive.reservationHistory.find(
        ({ dotyposReservationId }) => dotyposReservationId === aDeskReservation
      );
      expect(desk).toBeDefined();
      expect(desk?.product).toBeNull();
    });
  });

  type BoundedRead = {
    readonly code: AccountDataExportFailureCode;
    readonly limit: keyof AccountDataExportLimits;
    /**
     * Adds the customer's `index`th row of the section; a reservation-keyed
     * row goes to `reservationFor(index)`, alternating between two.
     */
    readonly add: (
      customer: SeededCustomer,
      reservationFor: (index: number) => WorkspaceReservationId,
      index: number
    ) => Promise<unknown>;
    readonly rows: (archive: Archive) => readonly unknown[];
  };

  /** Payment attempts per reservation, created on first use. */
  const attempts = new Map<WorkspaceReservationId, PaymentAttemptId>();
  const attemptFor = async (reservationId: WorkspaceReservationId) => {
    const existing = attempts.get(reservationId);
    if (existing) return existing;
    const created = await seedPayment(reservationId);
    attempts.set(reservationId, created);
    return created;
  };

  const boundedReads: readonly BoundedRead[] = [
    {
      code: "reservations.workspace",
      limit: "reservations",
      add: (customer) =>
        run(
          workspaceFixtures(database()).reservation({
            stage: { reservation: "confirmed" },
            customer: customer.customerId,
            author: customer.accountId,
          })
        ),
      rows: (archive) => archive.workspaceReservations,
    },
    {
      code: "reservations.dotypos",
      limit: "reservations",
      add: async (customer) => addDotyposReservation(customer.customerId),
      rows: (archive) => archive.reservationHistory,
    },
    {
      code: "payments",
      limit: "payments",
      add: (_, reservationFor, index) => seedPayment(reservationFor(index)),
      rows: (archive) => archive.payments,
    },
    {
      code: "late-payment-recoveries",
      limit: "latePaymentRecoveries",
      add: async (_, reservationFor, index) => {
        const id = reservationFor(index);
        await seedLatePaymentRecovery(id, await seedPayment(id));
      },
      rows: (archive) => archive.latePaymentRecoveries,
    },
    {
      code: "discount-applications",
      limit: "discountApplications",
      add: async (_, reservationFor, index) => {
        const id = reservationFor(index);
        await seedDiscountApplication(id, await attemptFor(id), index);
      },
      rows: (archive) => archive.discountApplications,
    },
    {
      code: "invoices",
      limit: "invoices",
      add: (customer) => seedInvoice(customer.customerId),
      rows: (archive) => archive.invoices,
    },
    {
      // Each invoice also has an internal delivery, which the bound ignores.
      code: "invoice-deliveries",
      limit: "invoiceDeliveries",
      add: (customer) => seedInvoice(customer.customerId),
      rows: (archive) => archive.invoiceDeliveries,
    },
    {
      code: "legal-evidence",
      limit: "legalEvidenceEvents",
      add: (_, reservationFor, index) =>
        seedLegalEvidenceEvent(reservationFor(index)),
      rows: (archive) => archive.legalEvidenceEvents,
    },
    {
      // A reservation has one grant, so each grant brings its reservation.
      code: "access-grants",
      limit: "accessGrants",
      add: async (customer) =>
        seedAccessGrant((await seedReservation(customer)).id),
      rows: (archive) => archive.accessGrants,
    },
  ];

  const limit = 3;

  describe.each(boundedReads.map((read) => [read.code, read] as const))(
    "the %s read",
    (code, read) => {
      test("returns exactly the limit, across reservations, and fails one row over it", async () => {
        const customer = await seedCustomer(`bound-${code}`);
        // Two reservations Dotypos doesn't list, so they count toward no
        // bounded read but the Workspace reservations, which seed their own.
        const reservations =
          read.limit === "reservations"
            ? []
            : [
                await seedReservation(customer, { inDotypos: false }),
                await seedReservation(customer, { inDotypos: false }),
              ];
        const reservationFor = (index: number) =>
          reservations[index % reservations.length]!.id;
        const limits = { ...roomyLimits, [read.limit]: limit };
        for (let index = 0; index < limit; index += 1)
          await read.add(customer, reservationFor, index);

        const archive = await archiveFor(customer, limits);
        expect(read.rows(archive)).toHaveLength(limit);

        await read.add(customer, reservationFor, limit);
        expect(await failureFor(customer, limits)).toMatchObject({
          _tag: "AccountDataExportLoadError",
          code,
          kind: "over-limit",
        });
      });
    }
  );
});
