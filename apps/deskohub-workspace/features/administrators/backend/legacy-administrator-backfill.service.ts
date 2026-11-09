import type { AdministrationLegacyUsername } from "@deskohub/workspace-admin-api";
import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Context, Data, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  standaloneAccessCodeAttemptEvents as accessCodeEvents,
  cliSessions,
  manualInvoiceActors,
} from "@/db/schema";
import { WorkspaceLocks } from "@/db/workspace-locks";
import { findActiveCustomerAccountByEmail } from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import type { AdministratorAccountActor } from "../account-role";
import { AccountRoleGrants } from "./account-role-grants.service";

/** How the records a legacy username wrote relate to the target account. */
type LegacyActorRecordCounts = {
  /** Records linked by this run, or that a dry run would link. */
  readonly linked: number;
  readonly alreadyLinked: number;
  /** Records already linked to a different account, left unchanged. */
  readonly linkedToOtherAccount: number;
};

type LegacyAdministratorBackfillResult = {
  readonly dryRun: boolean;
  /** `granted` in a dry run means the run would grant it. */
  readonly administratorRole: "granted" | "already_granted";
  readonly cliSessions: LegacyActorRecordCounts;
  readonly manualInvoices: LegacyActorRecordCounts;
  readonly standaloneAccessCodeEvents: LegacyActorRecordCounts;
};

export class LegacyAdministratorAccountNotFound extends Data.TaggedError(
  "LegacyAdministratorAccountNotFound"
)<{ readonly message: string }> {}

export class LegacyAdministratorBackfillError extends Data.TaggedError(
  "LegacyAdministratorBackfillError"
)<{ readonly message: string; readonly cause: unknown }> {
  static storage = (cause: unknown) =>
    new LegacyAdministratorBackfillError({
      message: "Legacy administrator records could not be backfilled.",
      cause: censorLogValue(cause),
    });
}

interface ILegacyAdministratorBackfill {
  /**
   * Grants the administrator role to the active account that signs in with
   * `email`, and links the CLI sessions, manual invoices, and standalone
   * access-code events the legacy Basic-auth `legacyUsername` wrote to that
   * account. Records already linked keep their account, so a rerun changes
   * nothing. A dry run reports the same counts without writing.
   */
  readonly run: (input: {
    readonly legacyUsername: AdministrationLegacyUsername;
    readonly email: string;
    readonly dryRun: boolean;
  }) => Effect.Effect<
    LegacyAdministratorBackfillResult,
    LegacyAdministratorAccountNotFound | LegacyAdministratorBackfillError
  >;
}

export class LegacyAdministratorBackfill extends Context.Service<
  LegacyAdministratorBackfill,
  ILegacyAdministratorBackfill
>()("@deskohub-workspace/administrators/LegacyAdministratorBackfill") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const database = yield* WorkspaceDatabase;
      const { db, transaction } = yield* WorkspaceDatabase;
      const roleGrants = yield* AccountRoleGrants;
      const invoiceRepository = yield* InvoiceRepository;

      const grantAdministrator = Effect.fn(
        "LegacyAdministratorBackfill.grantAdministrator"
      )(function* (input: {
        readonly account: AdministratorAccountActor;
        readonly dryRun: boolean;
      }) {
        const key = {
          accountId: input.account.accountId,
          role: "administrator",
        } as const;
        const changed = input.dryRun
          ? !(yield* roleGrants.has(key))
          : (yield* roleGrants.grant({ ...key, grantedBy: null })).changed;
        return changed ? ("granted" as const) : ("already_granted" as const);
      });

      const countRecords = Effect.fn(
        "LegacyAdministratorBackfill.countRecords"
      )(function* (input: {
        readonly table: typeof cliSessions | typeof accessCodeEvents;
        readonly accountIdColumn: AnyPgColumn;
        readonly accountEmailColumn: AnyPgColumn;
        readonly where: SQL;
        readonly accountId: CustomerAccountId;
      }) {
        const { accountEmailColumn, accountId, accountIdColumn } = input;
        // A record whose account was deleted keeps its email snapshot, so it
        // counts as linked to another account rather than unlinked.
        const [counts] = yield* db
          .select({
            linked: sql<number>`count(*) filter (where ${accountEmailColumn} is null)::int`,
            alreadyLinked: sql<number>`count(*) filter (where ${accountIdColumn} = ${accountId})::int`,
            linkedToOtherAccount: sql<number>`count(*) filter (where ${accountEmailColumn} is not null and ${accountIdColumn} is distinct from ${accountId})::int`,
          })
          .from(input.table)
          .where(input.where);
        return (
          counts ?? { linked: 0, alreadyLinked: 0, linkedToOtherAccount: 0 }
        );
      });

      const linkCliSessions = Effect.fn(
        "LegacyAdministratorBackfill.linkCliSessions"
      )(function* (input: LinkInput) {
        const counts = yield* countRecords({
          table: cliSessions,
          accountIdColumn: cliSessions.approvedByAccountId,
          accountEmailColumn: cliSessions.approvedByAccountEmail,
          where: eq(cliSessions.approvedBy, input.legacyUsername),
          accountId: input.account.accountId,
        });
        yield* db
          .update(cliSessions)
          .set({
            approvedByAccountId: input.account.accountId,
            approvedByAccountEmail: input.account.email,
          })
          .where(
            and(
              eq(cliSessions.approvedBy, input.legacyUsername),
              isNull(cliSessions.approvedByAccountEmail)
            )
          )
          .pipe(Effect.when(Effect.succeed(!input.dryRun)));
        return counts;
      });

      const linkStandaloneAccessCodeEvents = Effect.fn(
        "LegacyAdministratorBackfill.linkStandaloneAccessCodeEvents"
      )(function* (input: LinkInput) {
        const counts = yield* countRecords({
          table: accessCodeEvents,
          accountIdColumn: accessCodeEvents.actorAccountId,
          accountEmailColumn: accessCodeEvents.actorAccountEmail,
          where: eq(accessCodeEvents.actor, input.legacyUsername),
          accountId: input.account.accountId,
        });
        yield* db
          .update(accessCodeEvents)
          .set({
            actorAccountId: input.account.accountId,
            actorAccountEmail: input.account.email,
          })
          .where(
            and(
              eq(accessCodeEvents.actor, input.legacyUsername),
              isNull(accessCodeEvents.actorAccountEmail)
            )
          )
          .pipe(Effect.when(Effect.succeed(!input.dryRun)));
        return counts;
      });

      // The legacy actor of a manual invoice lives only in its encrypted,
      // immutable document, so the invoices it issued are found by decrypting
      // them, and their account actor is recorded beside them.
      const linkManualInvoices = Effect.fn(
        "LegacyAdministratorBackfill.linkManualInvoices"
      )(function* (input: LinkInput) {
        const provenance =
          yield* invoiceRepository.listManualInvoiceProvenance();
        const invoiceIds = provenance
          .filter(({ provenance }) => provenance.actor === input.legacyUsername)
          .map(({ invoiceId }) => invoiceId);
        if (invoiceIds.length === 0) {
          return { linked: 0, alreadyLinked: 0, linkedToOtherAccount: 0 };
        }
        const existing = yield* db
          .select({
            invoiceId: manualInvoiceActors.invoiceId,
            actorAccountId: manualInvoiceActors.actorAccountId,
          })
          .from(manualInvoiceActors)
          .where(inArray(manualInvoiceActors.invoiceId, invoiceIds));
        const recorded = new Set(existing.map(({ invoiceId }) => invoiceId));
        const unlinked = invoiceIds.filter((id) => !recorded.has(id));
        // Drizzle rejects an empty insert while building it, so the insert
        // is built only when it runs.
        yield* Effect.suspend(() =>
          db
            .insert(manualInvoiceActors)
            .values(
              unlinked.map((invoiceId) => ({
                invoiceId,
                actorAccountId: input.account.accountId,
                actorAccountEmail: input.account.email,
              }))
            )
            .onConflictDoNothing()
        ).pipe(
          Effect.when(Effect.succeed(!input.dryRun && unlinked.length > 0))
        );
        const alreadyLinked = existing.filter(
          ({ actorAccountId }) => actorAccountId === input.account.accountId
        ).length;
        return {
          linked: unlinked.length,
          alreadyLinked,
          // Includes invoices whose recorded account was since deleted.
          linkedToOtherAccount: existing.length - alreadyLinked,
        };
      });

      const backfill = (input: LinkInput) =>
        transaction(
          Effect.succeed(input).pipe(
            Effect.tap(() =>
              WorkspaceLocks.legacyAdministrator(input.legacyUsername)
            ),
            Effect.bind("administratorRole", grantAdministrator),
            Effect.bind("cliSessions", linkCliSessions),
            Effect.bind("manualInvoices", linkManualInvoices),
            Effect.bind(
              "standaloneAccessCodeEvents",
              linkStandaloneAccessCodeEvents
            ),
            Effect.map(
              (result): LegacyAdministratorBackfillResult => ({
                dryRun: result.dryRun,
                administratorRole: result.administratorRole,
                cliSessions: result.cliSessions,
                manualInvoices: result.manualInvoices,
                standaloneAccessCodeEvents: result.standaloneAccessCodeEvents,
              })
            )
          )
        );

      return {
        run: Effect.fn("LegacyAdministratorBackfill.run")(function* ({
          dryRun,
          email,
          legacyUsername,
        }) {
          const account = yield* findActiveCustomerAccountByEmail(email).pipe(
            Effect.provideService(WorkspaceDatabase, database),
            Effect.mapError(LegacyAdministratorBackfillError.storage),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  new LegacyAdministratorAccountNotFound({
                    message:
                      "No active account signs in with that email. Sign in to Workspace with it once, then rerun.",
                  }),
                onSome: Effect.succeed,
              })
            )
          );
          return yield* backfill({ account, dryRun, legacyUsername }).pipe(
            Effect.mapError(LegacyAdministratorBackfillError.storage)
          );
        }),
      } satisfies ILegacyAdministratorBackfill;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        AccountRoleGrants.Live,
        InvoiceRepository.Live
      )
    )
  );
}

type LinkInput = {
  readonly account: AdministratorAccountActor;
  readonly dryRun: boolean;
  readonly legacyUsername: AdministrationLegacyUsername;
};
