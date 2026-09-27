import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { CustomerMarketingConsent } from "@/db/schema/customer-marketing-consents";
import type { Locale } from "@/features/i18n";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import {
  accountDataExportCompletenessNote,
  accountDataExportManifestPath,
  accountDataExportNonAtomicityNote,
  accountDataExportSchemaVersion,
  accountDataExportSections,
} from "../account-data-export-sections";
import {
  type CustomerAccountAccessError,
  type CustomerAccountId,
  mapCustomerAccountFailure,
} from "../customer-account";
import {
  AccountDataExportRecordsRepository,
  type CustomerExportRecords,
} from "./account-data-export-records.repository";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import type { CustomerAccountSession } from "./customer-authentication.service";
import { CustomerDotyposAdapter } from "./customer-dotypos-adapter.service";
import { CustomerReservationHistoryService } from "./customer-reservation-history.service";

/**
 * One archive entry: a fixed allowlisted file path and its JSON-ready
 * payload. The payload is always a domain projection, never a raw database
 * or provider row.
 */
export type AccountDataExportEntry = {
  readonly path: string;
  readonly content: unknown;
};

/**
 * The complete archive content: the manifest entry followed by exactly the
 * allowlisted sections in their fixed order. Assembly happens per request
 * in memory; nothing is stored.
 */
export type AccountDataExportArchive = {
  readonly entries: readonly AccountDataExportEntry[];
};

export type AccountDataExportInput = {
  readonly account: {
    readonly accountId: CustomerAccountId;
    readonly dotyposCustomerId: DotyposCustomerId;
  };
  readonly session: CustomerAccountSession;
};

const instantOf = (value: Temporal.Instant | Date | null | undefined) => {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value.toString();
};

const toConsentSection = (
  consent: CustomerMarketingConsent
): {
  grantedAt: string;
  withdrawnAt: string | null;
  locale: Locale;
} => ({
  grantedAt: consent.grantedAt.toString(),
  withdrawnAt: instantOf(consent.withdrawnAt),
  locale: consent.locale,
});

interface IAccountDataExportService {
  readonly build: (
    input: AccountDataExportInput
  ) => Effect.Effect<AccountDataExportArchive, CustomerAccountAccessError>;
}

/**
 * Builds the self-service account data archive described in
 * docs/account-data-export.md. The whole archive is assembled during the
 * request: any provider or database failure fails the entire export, so a
 * partial archive can never leave the server. Every entry originates in an
 * allowlisted projection that excludes credentials, tokens, provider
 * internals, and other customers' records; records that cannot be
 * attributed to the verified customer are excluded and routed to the full
 * manual access path.
 */
export class AccountDataExportService extends Context.Service<
  AccountDataExportService,
  IAccountDataExportService
>()("@deskohub-workspace/account/AccountDataExportService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const links = yield* CustomerAccountLinkRepository;
      const dotypos = yield* CustomerDotyposAdapter;
      const history = yield* CustomerReservationHistoryService;
      const consents = yield* CustomerMarketingConsentRepository;
      const records = yield* AccountDataExportRecordsRepository;

      const build = Effect.fn("AccountDataExportService.build")(function* ({
        account,
        session,
      }: AccountDataExportInput) {
        // Fail closed on a deletion marker or a removed identity before any
        // section is read, even though the route already resolved the account.
        yield* requireAccountActivity(links, account.accountId);

        const profile = yield* dotypos
          .readCustomerProfile(account.dotyposCustomerId)
          .pipe(
            Effect.mapError(
              mapCustomerAccountFailure("dotypos.customer-lookup")
            )
          );

        const reservationGroups = yield* history.load(account).pipe(
          Effect.mapError(mapCustomerAccountFailure("account.data-export")),
          Effect.flatMap((loaded) =>
            loaded.kind === "available"
              ? Effect.succeed(loaded.groups)
              : Effect.fail(
                  mapCustomerAccountFailure("account.data-export")(
                    new Error("history-unavailable")
                  )
                )
          )
        );

        const consent = yield* consents
          .get(account.dotyposCustomerId)
          .pipe(
            Effect.mapError(mapCustomerAccountFailure("account.data-export"))
          );

        const customerRecords: CustomerExportRecords = yield* records
          .loadCustomerRecords(account.dotyposCustomerId)
          .pipe(
            Effect.mapError(mapCustomerAccountFailure("account.data-export"))
          );

        const sectionPayloads: readonly unknown[] = [
          {
            accountId: session.accountId,
            email: session.email,
            emailVerified: true,
            name: session.displayName,
            accountCreatedAt: instantOf(session.accountCreatedAt),
            accountUpdatedAt: instantOf(session.accountUpdatedAt),
            deletionRequested: session.deletionRequested,
          },
          profile,
          [
            ...reservationGroups.current,
            ...reservationGroups.past,
            ...reservationGroups.unavailable,
          ],
          customerRecords.reservations,
          {
            payments: customerRecords.payments,
            latePaymentRecoveries: customerRecords.latePaymentRecoveries,
          },
          customerRecords.discountApplications,
          {
            invoices: customerRecords.invoices,
            customerEmailDeliveries: customerRecords.invoiceDeliveries,
          },
          {
            marketingConsent: consent ? toConsentSection(consent) : null,
            legalEvidenceEvents: customerRecords.legalEvidenceEvents,
          },
          { accessGrants: customerRecords.accessGrants },
        ];

        const generatedAt = Temporal.Now.instant().toString();

        const entries: AccountDataExportEntry[] = [
          {
            path: accountDataExportManifestPath,
            content: {
              schemaVersion: accountDataExportSchemaVersion,
              generatedAt,
              sections: accountDataExportSections.map((section) => ({
                path: section.path,
                description: section.manifestDescription,
              })),
              assembledDuringRequest: true,
              nonAtomicityNote: accountDataExportNonAtomicityNote,
              completenessNote: accountDataExportCompletenessNote,
            },
          },
          ...accountDataExportSections.map((section, index) => ({
            path: section.path,
            content: sectionPayloads[index],
          })),
        ];

        return { entries } satisfies AccountDataExportArchive;
      });

      return { build } satisfies IAccountDataExportService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountLinkRepository.Live,
        CustomerDotyposAdapter.Live,
        CustomerReservationHistoryService.Live,
        CustomerMarketingConsentRepository.Default.pipe(
          Layer.provide(WorkspaceDatabase.Default)
        ),
        AccountDataExportRecordsRepository.Default.pipe(
          Layer.provide(WorkspaceDatabase.Default)
        )
      )
    )
  );
}
