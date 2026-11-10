import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type InvoiceMetadata,
  InvoiceRepository,
} from "@/features/accounting/backend/invoice.repository";
import {
  type CustomerInvoiceDelivery,
  InvoiceEmailDeliveryRepository,
} from "@/features/accounting/backend/invoice-email-delivery.repository";
import {
  type CustomerDiscountApplicationRecord,
  DiscountApplicationRepository,
} from "@/features/checkout/backend/repositories/discount-application.repository";
import {
  type CustomerLatePaymentRecoveryRecord,
  LatePaymentRecoveryRepository,
} from "@/features/checkout/backend/repositories/late-payment-recovery.repository";
import {
  type CustomerLegalEvidenceEventRecord,
  LegalEvidenceEventRepository,
} from "@/features/checkout/backend/repositories/legal-evidence-event.repository";
import {
  type CustomerPaymentAttemptRecord,
  PaymentAttemptRepository,
} from "@/features/checkout/backend/repositories/payment-attempt.repository";
import {
  type CustomerMarketingConsent,
  MarketingConsentLedger,
} from "@/features/legal/backend/marketing-consent-ledger";
import {
  type CustomerBookedReservation,
  CustomerBookedReservations,
} from "@/features/reservation/backend/customer-booked-reservations";
import {
  type CustomerReservationRecord,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type ReservationAccessGrantStatus,
  ReservationAccessRepository,
} from "@/features/reservation-access/backend/reservation-access.repository";
import { ReadLimitExceededError } from "@/shared/backend/read-limit";
import { buildZipArchive } from "@/shared/backend/utils/zip-archive";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  currentInstant,
  temporalInstantToPlainDate,
} from "@/shared/utils/temporal";
import {
  accountDataExportCompletenessNote,
  accountDataExportManifestPath,
  accountDataExportNonAtomicityNote,
  accountDataExportSchemaVersion,
  accountDataExportSections,
} from "../account-data-export-sections";
import type { CustomerProfile } from "../contracts";
import {
  CustomerAccountAccessError,
  isCustomerAccountAccessDenial,
  type LinkedCustomerAccount,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  CustomerAccountResolver,
  requireVerifiedIdentity,
} from "./customer-account-resolver.service";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";

/**
 * The session has no active account whose data it may export: signed out,
 * unverified, no linked Dotypos customer, a review account, or deletion
 * pending.
 */
export class AccountDataExportUnavailableError extends Data.TaggedError(
  "AccountDataExportUnavailableError"
) {}

/** Which step failed; with the failure kind, the only detail a load failure keeps or logs. */
export type AccountDataExportFailureCode =
  | "account.authority"
  | "dotypos.profile"
  | "reservations.workspace"
  | "reservations.dotypos"
  | "payments"
  | "late-payment-recoveries"
  | "discount-applications"
  | "invoices"
  | "invoice-deliveries"
  | "marketing-consent"
  | "legal-evidence"
  | "access-grants"
  | "archive";

/**
 * `unreadable`: the source failed or returned something it couldn't vouch
 * for. `over-limit`: the source holds more rows than the export policy
 * allows, so nothing of it was returned.
 */
export type AccountDataExportFailureKind = "unreadable" | "over-limit";

/**
 * The archive couldn't be assembled. It keeps fixed values only, never the
 * cause or any part of the data read so far, and no partial archive exists.
 */
export class AccountDataExportLoadError extends Data.TaggedError(
  "AccountDataExportLoadError"
)<{
  readonly code: AccountDataExportFailureCode;
  readonly kind: AccountDataExportFailureKind;
}> {}

/**
 * The export policy: the most rows each bounded section read may return.
 * Every limit bounds the whole section, never one reservation's share; a
 * customer over a limit gets no archive.
 */
export type AccountDataExportLimits = {
  /** Workspace reservation records, and separately Dotypos reservations. */
  readonly reservations: number;
  readonly payments: number;
  readonly latePaymentRecoveries: number;
  readonly discountApplications: number;
  readonly invoices: number;
  readonly invoiceDeliveries: number;
  readonly legalEvidenceEvents: number;
  readonly accessGrants: number;
};

/** The production export policy; tests provide smaller limits. */
export const AccountDataExportLimits =
  Context.Reference<AccountDataExportLimits>(
    "@deskohub-workspace/account/AccountDataExportLimits",
    {
      defaultValue: () => ({
        reservations: 500,
        payments: 2000,
        latePaymentRecoveries: 500,
        discountApplications: 2000,
        invoices: 500,
        invoiceDeliveries: 500,
        legalEvidenceEvents: 2000,
        accessGrants: 500,
      }),
    }
  );

/**
 * What each archive section holds: owner projections only, never a raw row
 * or provider document. Instants serialize as ISO strings and amounts stay
 * exact `Money` values in minor units.
 */
type AccountDataExportContents = {
  readonly "identity.json": Pick<
    CustomerAccountSession,
    | "accountId"
    | "email"
    | "displayName"
    | "accountCreatedAt"
    | "accountUpdatedAt"
    | "deletionRequested"
  > & { readonly emailVerified: true };
  readonly "dotypos-profile.json": CustomerProfile | null;
  readonly "reservation-history.json": readonly (CustomerBookedReservation & {
    readonly product: CustomerReservationRecord["product"] | null;
  })[];
  readonly "workspace-reservations.json": readonly CustomerReservationRecord[];
  readonly "payments.json": {
    readonly payments: readonly CustomerPaymentAttemptRecord[];
    readonly latePaymentRecoveries: readonly CustomerLatePaymentRecoveryRecord[];
  };
  readonly "discount-applications.json": readonly CustomerDiscountApplicationRecord[];
  readonly "invoices.json": {
    readonly invoices: readonly InvoiceMetadata[];
    readonly customerEmailDeliveries: readonly CustomerInvoiceDelivery[];
  };
  readonly "consents.json": {
    readonly marketingConsent: CustomerMarketingConsent | null;
    readonly legalEvidenceEvents: readonly CustomerLegalEvidenceEventRecord[];
  };
  readonly "access-grants.json": {
    readonly accessGrants: readonly ReservationAccessGrantStatus[];
  };
};

/** The archive as a file, ready for `createDownloadResponse`. */
type AccountDataExportFile = {
  readonly bytes: Uint8Array;
  readonly fileName: string;
};

/** What decides whether a session may export its account data. */
export type AccountDataExportAuthority =
  | CustomerAccountResolver
  | CustomerAuthentication
  | CustomerAccountLinkRepository;

/** The live authority: the browser session and its account link. */
export const accountDataExportAuthorityLive = Layer.mergeAll(
  CustomerAccountResolver.Live,
  CustomerAuthentication.Default,
  CustomerAccountLinkRepository.Live
);

/**
 * The linked account whose data this session may export, and the session it
 * was resolved from. The identity section comes from this session, so it
 * must be the account the resolver linked; the activity re-read stops a
 * pending deletion. Every refusal fails with
 * `AccountDataExportUnavailableError`, an unreadable authority with a load
 * failure. The archive download and the legal page's offer of it both
 * authorize here, so the page offers the download to exactly the sessions
 * the route serves.
 */
export const authorizeAccountDataExport: Effect.Effect<
  {
    readonly account: LinkedCustomerAccount;
    readonly session: CustomerAccountSession;
  },
  AccountDataExportUnavailableError | AccountDataExportLoadError,
  AccountDataExportAuthority
> = Effect.gen(function* () {
  const account = yield* Effect.flatMap(
    CustomerAccountResolver,
    (resolver) => resolver.resolve
  );
  const session = yield* Effect.flatMap(
    CustomerAuthentication,
    (authentication) => authentication.currentUser
  ).pipe(Effect.flatMap(requireVerifiedIdentity));
  if (session.accountId !== account.accountId) {
    return yield* new CustomerAccountAccessError({
      reason: "unauthenticated",
    });
  }
  yield* requireAccountActivity(
    yield* CustomerAccountLinkRepository,
    account.accountId
  );
  return { account, session };
}).pipe(
  Effect.catchTag(
    "CustomerAccountAccessError",
    (
      error
    ): Effect.Effect<
      never,
      AccountDataExportUnavailableError | AccountDataExportLoadError
    > =>
      isCustomerAccountAccessDenial(error)
        ? Effect.fail(new AccountDataExportUnavailableError())
        : failLoad("account.authority", "unreadable")
  )
);

interface IAccountDataExportService {
  /**
   * The signed-in customer's data archive. Any unreadable source or exceeded
   * limit fails the whole archive.
   */
  readonly download: Effect.Effect<
    AccountDataExportFile,
    AccountDataExportUnavailableError | AccountDataExportLoadError
  >;
}

/**
 * A signed-in customer's self-service data archive. It re-authorizes from the
 * authoritative session like `CustomerInvoiceService`, then reads every
 * section through the module that owns it, scoped to the linked Dotypos
 * customer: reservation-keyed sections take the ids of the Workspace
 * reservations made for that customer, so a reservation the account booked
 * for someone else is never read. Reads are plain and sequential, without a
 * transaction (the archive spans Dotypos and Workspace, so a database
 * snapshot wouldn't make it atomic; the manifest says so). The archive lives
 * only in this request's memory; nothing is stored, sent, or logged beyond a
 * fixed failure code.
 */
export class AccountDataExportService extends Context.Service<
  AccountDataExportService,
  IAccountDataExportService
>()("@deskohub-workspace/account/AccountDataExportService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const limits = yield* AccountDataExportLimits;
      const authority = Context.pick(
        CustomerAccountResolver,
        CustomerAuthentication,
        CustomerAccountLinkRepository
      )(yield* Effect.context<AccountDataExportAuthority>());
      const dotypos = yield* CustomerDotyposAdapter;
      const workspaceReservations = yield* WorkspaceReservationRepository;
      const bookedReservations = yield* CustomerBookedReservations;
      const payments = yield* PaymentAttemptRepository;
      const latePaymentRecoveries = yield* LatePaymentRecoveryRepository;
      const discountApplications = yield* DiscountApplicationRepository;
      const invoices = yield* InvoiceRepository;
      const invoiceDeliveries = yield* InvoiceEmailDeliveryRepository;
      const marketingConsents = yield* MarketingConsentLedger;
      const legalEvidence = yield* LegalEvidenceEventRepository;
      const accessGrants = yield* ReservationAccessRepository;

      const authorize = authorizeAccountDataExport.pipe(
        Effect.provideContext(authority)
      );

      const download = Effect.gen(function* () {
        const { account, session } = yield* authorize;
        const customerId = account.dotyposCustomerId;

        const profile = yield* readSection(
          "dotypos.profile",
          dotypos.readCustomerProfile(customerId)
        );
        const reservations = yield* readSection(
          "reservations.workspace",
          workspaceReservations.listForCustomer({
            dotyposCustomerId: customerId,
            limit: limits.reservations,
          })
        );
        const booked = yield* readSection(
          "reservations.dotypos",
          bookedReservations.listForCustomer({
            customerId,
            limit: limits.reservations,
          })
        );
        const workspaceReservationIds = reservations.map(({ id }) => id);
        const paymentAttempts = yield* readSection(
          "payments",
          payments.listForReservations({
            workspaceReservationIds,
            limit: limits.payments,
          })
        );
        const recoveries = yield* readSection(
          "late-payment-recoveries",
          latePaymentRecoveries.listForReservations({
            workspaceReservationIds,
            limit: limits.latePaymentRecoveries,
          })
        );
        const discounts = yield* readSection(
          "discount-applications",
          discountApplications.listForReservations({
            workspaceReservationIds,
            limit: limits.discountApplications,
          })
        );
        const issuedInvoices = yield* readSection(
          "invoices",
          invoices.listMetadataForCustomer({
            dotyposCustomerId: customerId,
            limit: limits.invoices,
          })
        );
        const deliveries = yield* readSection(
          "invoice-deliveries",
          invoiceDeliveries.listForCustomer({
            dotyposCustomerId: customerId,
            limit: limits.invoiceDeliveries,
          })
        );
        const marketingConsent = yield* readSection(
          "marketing-consent",
          marketingConsents.find(customerId)
        );
        const legalEvidenceEvents = yield* readSection(
          "legal-evidence",
          legalEvidence.listForReservations({
            workspaceReservationIds,
            limit: limits.legalEvidenceEvents,
          })
        );
        const grants = yield* readSection(
          "access-grants",
          accessGrants.listForReservations({
            workspaceReservationIds,
            limit: limits.accessGrants,
          })
        );

        const generatedAt = yield* currentInstant;
        const sections = {
          "identity.json": {
            accountId: session.accountId,
            email: session.email,
            emailVerified: true,
            displayName: session.displayName,
            accountCreatedAt: session.accountCreatedAt,
            accountUpdatedAt: session.accountUpdatedAt,
            deletionRequested: session.deletionRequested,
          },
          "dotypos-profile.json": profile,
          "reservation-history.json": withProducts(booked, reservations),
          "workspace-reservations.json": reservations,
          "payments.json": {
            payments: paymentAttempts,
            latePaymentRecoveries: recoveries,
          },
          "discount-applications.json": discounts,
          "invoices.json": {
            invoices: issuedInvoices,
            customerEmailDeliveries: deliveries,
          },
          "consents.json": { marketingConsent, legalEvidenceEvents },
          "access-grants.json": { accessGrants: grants },
        } satisfies AccountDataExportContents;
        const manifest = {
          schemaVersion: accountDataExportSchemaVersion,
          generatedAt,
          sections: accountDataExportSections.map((section) => ({
            path: section.path,
            description: section.manifestDescription,
          })),
          assembledDuringRequest: true,
          nonAtomicityNote: accountDataExportNonAtomicityNote,
          completenessNote: accountDataExportCompletenessNote,
        };

        const bytes = yield* Effect.try({
          try: () =>
            buildZipArchive([
              {
                path: accountDataExportManifestPath,
                content: toJsonFile(manifest),
              },
              ...accountDataExportSections.map(({ path }) => ({
                path,
                content: toJsonFile(sections[path]),
              })),
            ]),
          catch: () => "archive" as const,
        }).pipe(Effect.catch(() => failLoad("archive", "unreadable")));

        const generatedOn = temporalInstantToPlainDate({
          instant: generatedAt,
          timeZone: workspaceSiteConstants.location.timeZone,
        });
        return {
          bytes,
          fileName: `deskohub-account-data-${generatedOn}.zip`,
        } satisfies AccountDataExportFile;
      }).pipe(Effect.withSpan("AccountDataExportService.download"));

      return { download } satisfies IAccountDataExportService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        accountDataExportAuthorityLive,
        CustomerDotyposAdapter.Live,
        CustomerBookedReservations.Live,
        WorkspaceReservationRepository.Live,
        Layer.mergeAll(
          PaymentAttemptRepository.Default,
          LatePaymentRecoveryRepository.Default,
          DiscountApplicationRepository.Default
        ).pipe(Layer.provide(WorkspaceDatabase.Default)),
        LegalEvidenceEventRepository.Live,
        InvoiceRepository.Live,
        InvoiceEmailDeliveryRepository.Live,
        MarketingConsentLedger.Live,
        ReservationAccessRepository.Live
      )
    )
  );
}

/**
 * Each Dotypos reservation with the product of the customer's Workspace
 * reservation record that names it. Dotypos holds no product, so a
 * reservation without a Workspace record, such as one booked at the desk,
 * has a null product.
 */
const withProducts = (
  booked: readonly CustomerBookedReservation[],
  reservations: readonly CustomerReservationRecord[]
) => {
  const products = new Map(
    reservations.flatMap(({ dotyposReservationId, product }) =>
      dotyposReservationId ? [[dotyposReservationId, product] as const] : []
    )
  );
  return booked.map((reservation) => ({
    ...reservation,
    product: products.get(reservation.dotyposReservationId) ?? null,
  }));
};

/** An archive entry's JSON text; instants serialize as ISO strings. */
const toJsonFile = (content: object | null) =>
  `${JSON.stringify(content, null, 2)}\n`;

/**
 * Reads one section, mapping every failure to the section's fixed code. A
 * limit overflow is told apart so the logged code says which policy limit
 * a customer outgrew.
 */
const readSection = <A, E>(
  code: AccountDataExportFailureCode,
  read: Effect.Effect<A, E>
): Effect.Effect<A, AccountDataExportLoadError> =>
  read.pipe(
    Effect.catch((error) =>
      failLoad(
        code,
        error instanceof ReadLimitExceededError ? "over-limit" : "unreadable"
      )
    )
  );

/** Logs the step's fixed values, never its cause, and fails with them. */
const failLoad = (
  code: AccountDataExportFailureCode,
  kind: AccountDataExportFailureKind
) =>
  Effect.logError("Account data export could not be assembled", {
    failureCode: code,
    failureKind: kind,
  }).pipe(
    Effect.andThen(Effect.fail(new AccountDataExportLoadError({ code, kind })))
  );
