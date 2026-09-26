import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { CustomerMarketingConsent } from "@/db/schema/customer-marketing-consents";
import type { Locale } from "@/features/i18n";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository"; /**
 * The version of the exported document shape. Increase it whenever an
 * exported section's meaning changes, never to flag data freshness.
 */
import type { CustomerReservationSummary } from "../contracts";
import {
  type CustomerAccountAccessError,
  type CustomerAccountId,
  mapCustomerAccountFailure,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import type { CustomerAccountSession } from "./customer-authentication.service";
import {
  CustomerDotyposAdapter,
  type CustomerProfile,
} from "./customer-dotypos-adapter.service";
import { CustomerReservationHistoryService } from "./customer-reservation-history.service";
export const accountDataExportSchemaVersion = 1;

const accountDataExportScopes = [
  "identity",
  "dotyposProfile",
  "reservations",
  "marketingConsent",
] as const;

/**
 * The allowlisted export sections. Every value originates in a domain
 * projection that already excludes provider internals, credentials, tokens,
 * session identifiers, and other customers' records; no raw provider row,
 * database model, or free-text field is ever serialized.
 */
export type AccountDataExportSnapshot = {
  readonly identity: {
    readonly accountId: CustomerAccountId;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly name: string | null;
    readonly accountCreatedAt: string | null;
    readonly accountUpdatedAt: string | null;
    readonly deletionRequested: boolean;
  };
  readonly dotyposProfile: CustomerProfile | null;
  readonly reservations: readonly CustomerReservationSummary[];
  readonly marketingConsent: {
    readonly grantedAt: string;
    readonly withdrawnAt: string | null;
    readonly locale: Locale;
  } | null;
  readonly meta: {
    readonly schemaVersion: typeof accountDataExportSchemaVersion;
    readonly generatedAt: string;
    readonly scope: readonly (typeof accountDataExportScopes)[number][];
    readonly assembledDuringRequest: boolean;
  };
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
): AccountDataExportSnapshot["marketingConsent"] => ({
  grantedAt: consent.grantedAt.toString(),
  withdrawnAt: instantOf(consent.withdrawnAt),
  locale: consent.locale,
});

interface IAccountDataExportService {
  readonly build: (
    input: AccountDataExportInput
  ) => Effect.Effect<AccountDataExportSnapshot, CustomerAccountAccessError>;
}

/**
 * Builds the self-service account data snapshot described in
 * docs/account-data-export.md. The whole snapshot is assembled during the
 * request: any provider or database failure fails the entire export, so a
 * partial document can never leave the server.
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

        return {
          identity: {
            accountId: session.accountId,
            email: session.email,
            emailVerified: true,
            name: session.displayName,
            accountCreatedAt: instantOf(session.accountCreatedAt),
            accountUpdatedAt: instantOf(session.accountUpdatedAt),
            deletionRequested: session.deletionRequested,
          },
          dotyposProfile: profile,
          reservations: [
            ...reservationGroups.current,
            ...reservationGroups.past,
            ...reservationGroups.unavailable,
          ],
          marketingConsent: consent ? toConsentSection(consent) : null,
          meta: {
            schemaVersion: accountDataExportSchemaVersion,
            generatedAt: Temporal.Now.instant().toString(),
            scope: accountDataExportScopes,
            assembledDuringRequest: true,
          },
        } satisfies AccountDataExportSnapshot;
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
        )
      )
    )
  );
}
