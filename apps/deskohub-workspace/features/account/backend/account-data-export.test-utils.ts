import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Data, Effect, Layer } from "effect";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { InvoiceEmailDeliveryRepository } from "@/features/accounting/backend/invoice-email-delivery.repository";
import { invoiceNumberSchema } from "@/features/accounting/invoice";
import { DiscountApplicationRepository } from "@/features/checkout/backend/repositories/discount-application.repository";
import { LatePaymentRecoveryRepository } from "@/features/checkout/backend/repositories/late-payment-recovery.repository";
import { LegalEvidenceEventRepository } from "@/features/checkout/backend/repositories/legal-evidence-event.repository";
import { PaymentAttemptRepository } from "@/features/checkout/backend/repositories/payment-attempt.repository";
import { discountIdSchema } from "@/features/discounts/contracts";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { CustomerBookedReservations } from "@/features/reservation/backend/customer-booked-reservations";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { ReservationAccessRepository } from "@/features/reservation-access/backend/reservation-access.repository";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAccountResolver } from "./customer-account-resolver.service";
import { CustomerAuthentication } from "./customer-authentication.service";
import { testSessionProfile } from "./customer-authentication.test-utils";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";

type ServiceOf<T> = T extends { readonly Service: infer S } ? S : never;
type ReadOf<T, K extends keyof ServiceOf<T>> = ServiceOf<T>[K] extends (
  ...args: never[]
) => infer R
  ? R
  : ServiceOf<T>[K];

/** What every source answers, in its owner's own types. */
type OwnerAnswers = {
  readonly resolve: ReadOf<typeof CustomerAccountResolver, "resolve">;
  readonly session: ReadOf<typeof CustomerAuthentication, "currentUser">;
  readonly activity: ReadOf<
    typeof CustomerAccountLinkRepository,
    "findActivityState"
  >;
  readonly profile: ReadOf<
    typeof CustomerDotyposAdapter,
    "readCustomerProfile"
  >;
  readonly workspaceReservations: ReadOf<
    typeof WorkspaceReservationRepository,
    "listForCustomer"
  >;
  readonly bookedReservations: ReadOf<
    typeof CustomerBookedReservations,
    "listForCustomer"
  >;
  readonly payments: ReadOf<
    typeof PaymentAttemptRepository,
    "listForReservations"
  >;
  readonly latePaymentRecoveries: ReadOf<
    typeof LatePaymentRecoveryRepository,
    "listForReservations"
  >;
  readonly discountApplications: ReadOf<
    typeof DiscountApplicationRepository,
    "listForReservations"
  >;
  readonly invoices: ReadOf<
    typeof InvoiceRepository,
    "listMetadataForCustomer"
  >;
  readonly invoiceDeliveries: ReadOf<
    typeof InvoiceEmailDeliveryRepository,
    "listForCustomer"
  >;
  readonly marketingConsent: ReadOf<typeof MarketingConsentLedger, "find">;
  readonly legalEvidenceEvents: ReadOf<
    typeof LegalEvidenceEventRepository,
    "listForReservations"
  >;
  readonly accessGrants: ReadOf<
    typeof ReservationAccessRepository,
    "listForReservations"
  >;
};

/**
 * A source's failure that stands for any failure in its owner's error
 * channel: the export maps every one of them alike, except an exceeded read
 * limit, which a test fails with `ReadLimitExceededError` itself.
 */
export class SyntheticSourceFailure extends Data.TaggedError(
  "SyntheticSourceFailure"
) {}

/**
 * What every source of the account data export answers. Each read is an
 * Effect a test may replace, such as with a `SyntheticSourceFailure` or an
 * oversized list.
 */
export type AccountDataExportSources = {
  readonly [Source in keyof OwnerAnswers]: OwnerAnswers[Source] extends Effect.Effect<
    infer A,
    infer E
  >
    ? Effect.Effect<A, E | SyntheticSourceFailure>
    : never;
};

/** One source read as the export made it: the source's name and its input. */
export type AccountDataExportRead = {
  readonly source: keyof AccountDataExportSources;
  readonly input?: string | object;
};

export const exportAccountId = customerAccountIdSchema.make(
  "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a42"
);
export const exportCustomerId = DotyposCustomerIdSchema.make(
  "dotypos-customer-export"
);
export const exportReservationId = workspaceReservationIdSchema.make(
  "018f47d2-8f7c-7c5e-9f9a-6ef21f90cc01"
);
export const exportDotyposReservationId = DotyposReservationIdSchema.make(
  "dotypos-reservation-export"
);
/** A Dotypos reservation without a Workspace record, booked at the desk. */
export const deskDotyposReservationId = DotyposReservationIdSchema.make(
  "dotypos-reservation-desk"
);

const at = (instant: string) => Temporal.Instant.from(instant);
const czk = (value: number) => ({ value, exponent: 2, currency: "CZK" });

/**
 * A linked, active, verified account whose customer has one record in every
 * section. Synthetic values only.
 */
export const syntheticExportSources = (): AccountDataExportSources => ({
  resolve: Effect.succeed({
    accountId: exportAccountId,
    dotyposCustomerId: exportCustomerId,
  }),
  session: Effect.succeed({
    accountId: exportAccountId,
    email: testEmailAddress("account-data-export"),
    deletionRequested: false,
    ...testSessionProfile,
  }),
  activity: Effect.succeed({
    kind: "active",
    email: testEmailAddress("account-data-export"),
    deletionRequestedAt: null,
  }),
  profile: Effect.succeed({
    firstName: "Ada",
    lastName: "Synthetic",
    phone: null,
    billing: null,
  }),
  workspaceReservations: Effect.succeed([
    {
      id: exportReservationId,
      dotyposReservationId: exportDotyposReservationId,
      reservationPurpose: "personal",
      reservationState: "confirmed",
      paymentState: "paid",
      fulfillmentState: "fulfilled",
      locale: "en-US",
      reservationCreatedAt: at("2026-08-01T08:00:00Z"),
      reservationConfirmedAt: at("2026-08-01T08:05:00Z"),
      reservationCancelledAt: null,
      paidAt: at("2026-08-01T08:04:00Z"),
      fulfilledAt: at("2026-08-01T08:06:00Z"),
      product: { kind: "cowork", entryTier: "basic", coffee: false },
    },
  ]),
  bookedReservations: Effect.succeed([
    {
      dotyposReservationId: exportDotyposReservationId,
      status: "CONFIRMED",
      heldFrom: at("2026-08-10T07:00:00Z"),
      heldUntil: at("2026-08-10T15:00:00Z"),
      seats: 1,
    },
    {
      dotyposReservationId: deskDotyposReservationId,
      status: "CONFIRMED",
      heldFrom: at("2026-08-12T07:00:00Z"),
      heldUntil: at("2026-08-12T15:00:00Z"),
      seats: 2,
    },
  ]),
  payments: Effect.succeed([
    {
      workspaceReservationId: exportReservationId,
      provider: "nexi",
      state: "paid",
      refundState: "not_required",
      amount: czk(45_050),
      refundedAmount: null,
      refundedAt: null,
      createdAt: at("2026-08-01T08:01:00Z"),
      updatedAt: at("2026-08-01T08:04:00Z"),
    },
  ]),
  latePaymentRecoveries: Effect.succeed([]),
  discountApplications: Effect.succeed([
    {
      workspaceReservationId: exportReservationId,
      sequence: 0,
      publicDiscountId: discountIdSchema.make("synthetic-discount"),
      label: "Synthetic discount",
      subtotalBefore: czk(50_050),
      appliedAmount: czk(5000),
      subtotalAfter: czk(45_050),
      createdAt: at("2026-08-01T08:01:00Z"),
    },
  ]),
  invoices: Effect.succeed([
    {
      invoiceNumber: invoiceNumberSchema.make("WS-FV-2026-000042"),
      issuedAt: at("2026-08-01T08:07:00Z"),
      numberingYear: 2026,
      numberingSequence: 42,
      workspaceReservationId: null,
      paymentAttemptId: null,
      documentSnapshotRecordedAt: null,
    },
  ]),
  invoiceDeliveries: Effect.succeed([
    {
      invoiceNumber: invoiceNumberSchema.make("WS-FV-2026-000042"),
      state: "accepted",
      createdAt: at("2026-08-01T08:07:30Z"),
      acceptedAt: at("2026-08-01T08:07:31Z"),
    },
  ]),
  marketingConsent: Effect.succeed(null),
  legalEvidenceEvents: Effect.succeed([
    {
      workspaceReservationId: exportReservationId,
      documentKey: "terms",
      documentPath: "/en-US/terms",
      documentHash: "0".repeat(64),
      hashAlgorithm: "sha256",
      accepted: true,
      acceptedAt: at("2026-08-01T08:00:30Z"),
      locale: "en-US",
      source: "reservation_form",
      earlyPerformanceConsent: true,
    },
  ]),
  accessGrants: Effect.succeed([
    {
      workspaceReservationId: exportReservationId,
      state: "issued",
      scheduledAccessStartsAt: at("2026-08-10T06:45:00Z"),
      accessStartsAt: at("2026-08-10T06:45:00Z"),
      accessEndsAt: at("2026-08-10T15:15:00Z"),
      issuedAt: at("2026-08-10T06:30:00Z"),
    },
  ]),
});

/**
 * Every session the export refuses, each as a change to the synthetic
 * sources: signed out, unverified, unlinked, a review account, a session
 * that ended or changed account, and a requested, pending, or completed
 * deletion.
 */
export const accountDataExportRefusals: readonly [
  name: string,
  refuse: (sources: AccountDataExportSources) => AccountDataExportSources,
][] = [
  [
    "signed out",
    (s) => ({
      ...s,
      resolve: Effect.fail(
        new CustomerAccountAccessError({ reason: "unauthenticated" })
      ),
    }),
  ],
  [
    "unverified email",
    (s) => ({
      ...s,
      resolve: Effect.fail(
        new CustomerAccountAccessError({ reason: "unverified-email" })
      ),
    }),
  ],
  [
    "no linked customer",
    (s) => ({
      ...s,
      resolve: Effect.fail(
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "not-found",
        })
      ),
    }),
  ],
  [
    "a review account",
    (s) => ({
      ...s,
      resolve: Effect.fail(customerAccountUnavailable("account.review")),
    }),
  ],
  [
    "a session that ended after resolution",
    (s) => ({ ...s, session: Effect.succeed(null) }),
  ],
  [
    "a session of another account",
    (s) => ({
      ...s,
      session: s.session.pipe(
        Effect.map((session) =>
          session
            ? {
                ...session,
                accountId: customerAccountIdSchema.make(
                  "5b6f31d0-2c1a-4f0e-9a3d-6c7b8e2f1a99"
                ),
              }
            : session
        )
      ),
    }),
  ],
  [
    "a deletion request on the session",
    (s) => ({
      ...s,
      session: s.session.pipe(
        Effect.map((session) =>
          session ? { ...session, deletionRequested: true } : session
        )
      ),
    }),
  ],
  [
    "a removed account",
    (s) => ({ ...s, activity: Effect.succeed({ kind: "missing" }) }),
  ],
  [
    "a pending deletion",
    (s) => ({
      ...s,
      activity: Effect.succeed({
        kind: "active",
        email: testEmailAddress("account-data-export"),
        deletionRequestedAt: new Date("2026-09-01T10:00:00Z"),
      }),
    }),
  ],
];

/**
 * Every source the export service reads, answering from `sources()` at read
 * time and appending each read to `reads`.
 */
export const fakeAccountDataExportSources = (
  sources: () => AccountDataExportSources,
  reads: AccountDataExportRead[]
) => {
  const read =
    <K extends keyof AccountDataExportSources>(source: K) =>
    (input?: string | object) =>
      // The owner's interface has no `SyntheticSourceFailure`; it stands for
      // a failure the interface does declare.
      Effect.suspend(() => {
        reads.push(input === undefined ? { source } : { source, input });
        return sources()[source];
      }) as OwnerAnswers[K];
  return Layer.mergeAll(
    Layer.mock(CustomerAccountResolver, { resolve: read("resolve")() }),
    Layer.mock(CustomerAuthentication, { currentUser: read("session")() }),
    Layer.mock(CustomerAccountLinkRepository, {
      findActivityState: read("activity"),
    }),
    Layer.mock(CustomerDotyposAdapter, {
      readCustomerProfile: read("profile"),
    }),
    Layer.mock(WorkspaceReservationRepository, {
      listForCustomer: read("workspaceReservations"),
    }),
    Layer.mock(CustomerBookedReservations, {
      listForCustomer: read("bookedReservations"),
    }),
    Layer.mock(PaymentAttemptRepository, {
      listForReservations: read("payments"),
    }),
    Layer.mock(LatePaymentRecoveryRepository, {
      listForReservations: read("latePaymentRecoveries"),
    }),
    Layer.mock(DiscountApplicationRepository, {
      listForReservations: read("discountApplications"),
    }),
    Layer.mock(InvoiceRepository, {
      listMetadataForCustomer: read("invoices"),
    }),
    Layer.mock(InvoiceEmailDeliveryRepository, {
      listForCustomer: read("invoiceDeliveries"),
    }),
    Layer.mock(MarketingConsentLedger, { find: read("marketingConsent") }),
    Layer.mock(LegalEvidenceEventRepository, {
      listForReservations: read("legalEvidenceEvents"),
    }),
    Layer.mock(ReservationAccessRepository, {
      listForReservations: read("accessGrants"),
    })
  );
};
