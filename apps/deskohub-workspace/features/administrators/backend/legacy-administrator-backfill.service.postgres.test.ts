import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationLegacyUsername,
  type AdministrationLegacyUsernameType,
} from "@deskohub/workspace-admin-api";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  cliSessions,
  invoiceEmailDeliveries,
  invoices,
  manualInvoiceActors,
  standaloneAccessCodeAttemptEvents,
} from "@/db/schema";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyService,
} from "@/features/accounting/backend/accounting-snapshot-key.service";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { manualInvoiceInputSchema } from "@/features/accounting/manual-invoice";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  deleteTestAccounts,
  insertTestAccount,
} from "@/shared/testing/workspace-test-accounts.test-utils";
import type { AdministratorAccountActor } from "../account-role";
import { AccountRoleGrants } from "./account-role-grants.service";
import { LegacyAdministratorBackfill } from "./legacy-administrator-backfill.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const testAccounts: AdministratorAccountActor[] = [];

const testKey: AccountingSnapshotKey = {
  id: accountingSnapshotKeyIdSchema.make("K202610"),
  secret: "synthetic legacy administrator backfill secret",
};

const makeLayer = () => {
  const storage = Layer.merge(
    testDatabase!.layer,
    Layer.succeed(
      AccountingSnapshotKeyService,
      AccountingSnapshotKeyService.of({
        getActive: Effect.succeed(testKey),
        getById: () => Effect.succeed(testKey),
      })
    )
  );
  const invoiceRepository = InvoiceRepository.Default.pipe(
    Layer.provide(
      Layer.merge(
        storage,
        AccountingDocumentSnapshotRepository.Default.pipe(
          Layer.provide(storage)
        )
      )
    )
  );
  return LegacyAdministratorBackfill.Default.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        testDatabase!.layer,
        invoiceRepository,
        AccountRoleGrants.Default.pipe(Layer.provide(testDatabase!.layer))
      )
    )
  );
};

class RolledBack<A> extends Data.TaggedError("RolledBack")<{
  readonly result: A;
}> {}

/**
 * Runs a scenario in a transaction that is rolled back afterwards. It first
 * hides the manual invoices other suites leave in the shared database, whose
 * synthetic documents can't be decrypted.
 */
const runIsolated = <A, E>(
  scenario: Effect.Effect<
    A,
    E,
    LegacyAdministratorBackfill | InvoiceRepository | WorkspaceDatabase
  >
) =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;
    return yield* db
      .transaction(() =>
        Effect.gen(function* () {
          yield* db.execute(
            sql`alter table ${invoices} disable trigger invoices_immutable`
          );
          const otherManualInvoices = db
            .select({ id: invoices.id })
            .from(invoices)
            .where(isNull(invoices.workspaceReservationId));
          yield* db
            .delete(invoiceEmailDeliveries)
            .where(
              inArray(invoiceEmailDeliveries.invoiceId, otherManualInvoices)
            );
          yield* db
            .delete(manualInvoiceActors)
            .where(inArray(manualInvoiceActors.invoiceId, otherManualInvoices));
          yield* db
            .delete(invoices)
            .where(isNull(invoices.workspaceReservationId));
          yield* db.execute(
            sql`alter table ${invoices} enable trigger invoices_immutable`
          );
          const result = yield* scenario;
          return yield* new RolledBack({ result });
        })
      )
      .pipe(
        Effect.catchTag("RolledBack", ({ result }) => Effect.succeed(result))
      );
  }).pipe(Effect.provide(makeLayer()), Effect.runPromise);

const insertAccount = (local: string) =>
  Effect.promise(() => insertTestAccount(testDatabase!, local)).pipe(
    Effect.tap((account) =>
      Effect.sync(() => {
        testAccounts.push(account);
      })
    )
  );

const insertCliSession = (input: {
  readonly approvedBy: AdministrationLegacyUsernameType;
  readonly account?: { readonly accountId: string; readonly email: string };
}) =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;
    const [row] = yield* db
      .insert(cliSessions)
      .values({
        approvedBy: input.approvedBy,
        approvedByAccountId: input.account
          ? customerAccountIdSchema.make(input.account.accountId)
          : null,
        approvedByAccountEmail: input.account?.email ?? null,
        tokenHash: randomUUID().replaceAll("-", "").padEnd(43, "a"),
        clientName: "synthetic client",
        cliVersion: "1.0.0",
        buildTarget: "development",
      })
      .returning({ id: cliSessions.id });
    return row!.id;
  });

const insertAccessCodeEvent = (actor: AdministrationLegacyUsernameType) =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;
    yield* db.execute(sql`
      insert into standalone_access_code_attempt_events
        (attempt_id, event_kind, actor, source, name, device_id,
         starts_at_local, ends_at_local, starts_at, ends_at, variance, occurred_at)
      values
        (${randomUUID()}, 'started', ${actor}, 'admin-ui', 'Synthetic code', 'synthetic-device',
         '2099-01-01T10:00', '2099-01-01T12:00', '2099-01-01T09:00:00Z', '2099-01-01T11:00:00Z', 2, now())
    `);
  });

const issueManualInvoice = (
  actor: string,
  issuedBy: AdministratorAccountActor
) =>
  InvoiceRepository.pipe(
    Effect.flatMap((repository) =>
      repository.issueManual({
        ...Schema.decodeUnknownSync(manualInvoiceInputSchema)({
          invoiceId: randomUUID(),
          dotyposCustomerId: `legacy-administrator-customer-${randomUUID()}`,
          buyer: {
            kind: "person",
            legalName: "Synthetic Invoice Customer",
            address: {
              line1: "Synthetic 1",
              city: "Praha",
              postalCode: "100 00",
              country: "CZ",
            },
          },
          deliveryEmail: testEmailAddress("legacy-administrator-invoice"),
          locale: "en-US",
          serviceDate: "2099-01-01",
          payment: { status: "paid", date: "2099-01-01" },
          currency: "CZK",
          lines: [{ description: "Synthetic line", price: "100.00" }],
          provenance: { source: "dhw-cli", actor },
        }),
        issuedBy,
      })
    ),
    Effect.map(({ invoice }) => invoice.id)
  );

const uniqueUsername = () =>
  AdministrationLegacyUsername.make(`legacy-${randomUUID().slice(0, 8)}`);

const backfill = (input: {
  readonly legacyUsername: AdministrationLegacyUsernameType;
  readonly email: string;
  readonly dryRun: boolean;
}) =>
  LegacyAdministratorBackfill.pipe(
    Effect.flatMap((service) => service.run(input))
  );

describe.skipIf(!testDatabase)(
  "LegacyAdministratorBackfill on disposable Postgres",
  () => {
    afterAll(async () => {
      await deleteTestAccounts(testDatabase!, testAccounts);
    });

    test("reports, then links, a legacy username's records to the account", async () => {
      const outcome = await runIsolated(
        Effect.gen(function* () {
          const { db } = yield* WorkspaceDatabase;
          const legacyUsername = uniqueUsername();
          const otherUsername = uniqueUsername();
          const target = yield* insertAccount("legacy-target");
          const other = yield* insertAccount("legacy-other");

          const sessions = [
            yield* insertCliSession({ approvedBy: legacyUsername }),
            yield* insertCliSession({ approvedBy: legacyUsername }),
          ];
          const otherAccountSession = yield* insertCliSession({
            approvedBy: legacyUsername,
            account: other,
          });
          const unrelatedSession = yield* insertCliSession({
            approvedBy: otherUsername,
          });
          yield* insertAccessCodeEvent(legacyUsername);
          yield* insertAccessCodeEvent(otherUsername);
          const legacyInvoices = [
            yield* issueManualInvoice(legacyUsername, target),
            yield* issueManualInvoice(legacyUsername, target),
          ];
          const unrelatedInvoice = yield* issueManualInvoice(
            otherUsername,
            other
          );
          yield* db
            .delete(manualInvoiceActors)
            .where(
              inArray(manualInvoiceActors.invoiceId, [
                ...legacyInvoices,
                unrelatedInvoice,
              ])
            );

          const dryRun = yield* backfill({
            legacyUsername,
            email: target.email,
            dryRun: true,
          });
          const grantsAfterDryRun = yield* db.execute<{ count: number }>(
            sql`select count(*)::int as count from account_role_grants where account_id = ${target.accountId}`
          );
          const actorsAfterDryRun = yield* db
            .select()
            .from(manualInvoiceActors)
            .where(inArray(manualInvoiceActors.invoiceId, legacyInvoices));

          const applied = yield* backfill({
            legacyUsername,
            email: target.email,
            dryRun: false,
          });
          const rerun = yield* backfill({
            legacyUsername,
            email: target.email,
            dryRun: false,
          });
          const reassigned = yield* backfill({
            legacyUsername,
            email: other.email,
            dryRun: true,
          });

          const storedSessions = yield* db
            .select({
              id: cliSessions.id,
              accountId: cliSessions.approvedByAccountId,
              email: cliSessions.approvedByAccountEmail,
            })
            .from(cliSessions)
            .where(
              inArray(cliSessions.id, [
                ...sessions,
                otherAccountSession,
                unrelatedSession,
              ])
            );
          const storedEvents = yield* db
            .select({
              actor: standaloneAccessCodeAttemptEvents.actor,
              accountId: standaloneAccessCodeAttemptEvents.actorAccountId,
              email: standaloneAccessCodeAttemptEvents.actorAccountEmail,
            })
            .from(standaloneAccessCodeAttemptEvents)
            .where(
              inArray(standaloneAccessCodeAttemptEvents.actor, [
                legacyUsername,
                otherUsername,
              ])
            );
          const storedInvoiceActors = yield* db
            .select()
            .from(manualInvoiceActors)
            .where(
              inArray(manualInvoiceActors.invoiceId, [
                ...legacyInvoices,
                unrelatedInvoice,
              ])
            );
          const grants = yield* db.execute<{
            granted_by_account_id: string | null;
          }>(
            sql`select granted_by_account_id from account_role_grants where account_id = ${target.accountId} and role = 'administrator'`
          );

          return {
            target,
            other,
            sessions,
            otherAccountSession,
            unrelatedSession,
            legacyUsername,
            legacyInvoices,
            dryRun,
            grantsAfterDryRun: grantsAfterDryRun.rows,
            actorsAfterDryRun,
            applied,
            rerun,
            reassigned,
            storedSessions,
            storedEvents,
            storedInvoiceActors,
            grants: grants.rows,
          };
        })
      );

      expect(outcome.dryRun).toEqual({
        dryRun: true,
        administratorRole: "granted",
        cliSessions: { linked: 2, alreadyLinked: 0, linkedToOtherAccount: 1 },
        manualInvoices: {
          linked: 2,
          alreadyLinked: 0,
          linkedToOtherAccount: 0,
        },
        standaloneAccessCodeEvents: {
          linked: 1,
          alreadyLinked: 0,
          linkedToOtherAccount: 0,
        },
      });
      expect(outcome.grantsAfterDryRun).toEqual([{ count: 0 }]);
      expect(outcome.actorsAfterDryRun).toEqual([]);

      expect(outcome.applied).toEqual({ ...outcome.dryRun, dryRun: false });
      expect(outcome.rerun).toEqual({
        dryRun: false,
        administratorRole: "already_granted",
        cliSessions: { linked: 0, alreadyLinked: 2, linkedToOtherAccount: 1 },
        manualInvoices: {
          linked: 0,
          alreadyLinked: 2,
          linkedToOtherAccount: 0,
        },
        standaloneAccessCodeEvents: {
          linked: 0,
          alreadyLinked: 1,
          linkedToOtherAccount: 0,
        },
      });
      expect(outcome.reassigned).toEqual({
        dryRun: true,
        administratorRole: "granted",
        cliSessions: { linked: 0, alreadyLinked: 1, linkedToOtherAccount: 2 },
        manualInvoices: {
          linked: 0,
          alreadyLinked: 0,
          linkedToOtherAccount: 2,
        },
        standaloneAccessCodeEvents: {
          linked: 0,
          alreadyLinked: 0,
          linkedToOtherAccount: 1,
        },
      });

      const targetActor = {
        accountId: outcome.target.accountId,
        email: outcome.target.email,
      };
      expect(
        new Map(
          outcome.storedSessions.map(({ id, accountId, email }) => [
            id,
            { accountId, email },
          ])
        )
      ).toEqual(
        new Map([
          [outcome.sessions[0]!, targetActor],
          [outcome.sessions[1]!, targetActor],
          [
            outcome.otherAccountSession,
            { accountId: outcome.other.accountId, email: outcome.other.email },
          ],
          [outcome.unrelatedSession, { accountId: null, email: null }],
        ])
      );
      expect(
        outcome.storedEvents.map(({ actor, accountId, email }) =>
          actor === outcome.legacyUsername
            ? { accountId, email }
            : { unrelated: { accountId, email } }
        )
      ).toEqual(
        expect.arrayContaining([
          targetActor,
          { unrelated: { accountId: null, email: null } },
        ])
      );
      expect(
        outcome.storedInvoiceActors
          .map(({ invoiceId, actorAccountId, actorAccountEmail }) => ({
            invoiceId,
            accountId: actorAccountId,
            email: actorAccountEmail,
          }))
          .sort((left, right) => left.invoiceId.localeCompare(right.invoiceId))
      ).toEqual(
        [...outcome.legacyInvoices]
          .sort()
          .map((invoiceId) => ({ invoiceId, ...targetActor }))
      );
      expect(outcome.grants).toEqual([{ granted_by_account_id: null }]);
    });

    test("counts records of a deleted account as linked elsewhere", async () => {
      const outcome = await runIsolated(
        Effect.gen(function* () {
          const { db } = yield* WorkspaceDatabase;
          const legacyUsername = uniqueUsername();
          const former = yield* insertAccount("legacy-former");
          const target = yield* insertAccount("legacy-successor");
          yield* insertCliSession({ approvedBy: legacyUsername });
          yield* backfill({
            legacyUsername,
            email: former.email,
            dryRun: false,
          });
          yield* db.execute(
            sql`delete from auth."user" where id = ${former.accountId}`
          );
          const [session] = yield* db
            .select({
              accountId: cliSessions.approvedByAccountId,
              email: cliSessions.approvedByAccountEmail,
            })
            .from(cliSessions)
            .where(
              and(
                eq(cliSessions.approvedBy, legacyUsername),
                eq(cliSessions.approvedByAccountEmail, former.email)
              )
            );
          const result = yield* backfill({
            legacyUsername,
            email: target.email,
            dryRun: false,
          });
          return { session, result };
        })
      );

      expect(outcome.session?.accountId).toBeNull();
      expect(outcome.result.cliSessions).toEqual({
        linked: 0,
        alreadyLinked: 0,
        linkedToOtherAccount: 1,
      });
    });

    test("fails without writing when no active account uses the email", async () => {
      const error = await runIsolated(
        backfill({
          legacyUsername: uniqueUsername(),
          email: testEmailAddress("legacy-administrator-unknown"),
          dryRun: false,
        }).pipe(Effect.flip)
      );

      expect(error).toMatchObject({
        _tag: "LegacyAdministratorAccountNotFound",
      });
    });
  }
);
