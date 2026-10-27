import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { authPasskey, authSession, authUser } from "@/db/schema/auth";
import { customerAccounts } from "@/db/schema/customer-accounts";
import { CustomerAccountRepository } from "@/features/account/backend/customer-account.repository";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import {
  type ReservationFixtureInput,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import type { WorkspaceE2EError } from "../errors";
import { workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import {
  runDatabaseOperation,
  runRetrySafeDatabaseOperation,
} from "../integrations/database-operation";

/**
 * Exact-ID database helpers for synthetic account fixtures. Every read and
 * write is keyed by the journaled Better Auth user id or the exact synthetic
 * recipient; nothing scans or matches beyond those identities.
 */

export const findAuthUserIdByEmail = (
  email: string
): Effect.Effect<string | undefined, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "read synthetic auth user id",
      db
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.email, email))
    );
    return rows[0]?.id;
  });

export const findAuthUserEmailById = (
  accountId: string
): Effect.Effect<string | null | undefined, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "read synthetic auth user owner",
      db
        .select({ email: authUser.email })
        .from(authUser)
        .where(eq(authUser.id, sensitiveDatabaseParameter(accountId)))
    );
    return rows[0] ? rows[0].email : undefined;
  });

/**
 * The author of a reservation a fixture seeds for the customer: the live
 * account linked to it, else a new synthetic customer account without a
 * login, since every reservation has an author.
 */
export const seedWorkspaceE2EReservationAuthor = Effect.fn(
  "seedWorkspaceE2EReservationAuthor"
)(function* (executor: WorkspaceDatabaseClient, customerId: DotyposCustomerId) {
  const [linked] = yield* executor
    .select({ id: customerAccounts.id })
    .from(customerAccounts)
    .where(eq(customerAccounts.dotyposCustomerId, customerId));
  if (linked) return linked.id;
  return yield* workspaceFixtures(executor).customerAccount({
    id: customerAccountIdSchema.make(
      `e2e-reservation-author-${crypto.randomUUID()}`
    ),
  });
});

/**
 * A fixture reservation of one customer, inserted with the author
 * `seedWorkspaceE2EReservationAuthor` resolves for that customer.
 */
export type WorkspaceE2EAuthoredReservation = Omit<
  ReservationFixtureInput,
  "author" | "customer"
> & {
  readonly customer: DotyposCustomerId;
};

export const findLinkedDotyposCustomerId = (
  accountId: string
): Effect.Effect<string | undefined, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "read synthetic account link",
      db
        .select({ dotyposCustomerId: customerAccounts.dotyposCustomerId })
        .from(customerAccounts)
        .where(eq(customerAccounts.id, customerAccountIdSchema.make(accountId)))
    );
    return rows[0]?.dotyposCustomerId ?? undefined;
  });

export const removeSyntheticAccountLink = (
  accountId: string,
  customerId: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "delete synthetic account link",
      db
        .update(customerAccounts)
        .set({ dotyposCustomerId: null })
        .where(
          and(
            eq(customerAccounts.id, customerAccountIdSchema.make(accountId)),
            eq(
              customerAccounts.dotyposCustomerId,
              customerId as DotyposCustomerId
            )
          )
        )
        .returning({ customerAccountId: customerAccounts.id })
    );

    if (rows.length !== 1 || rows[0]?.customerAccountId !== accountId) {
      return yield* workspaceE2EError(
        "Synthetic account link cleanup did not remove exactly one matching row",
        {
          diagnosticCode: "postgres_account_fixture_assertion_failed",
          operation: "delete synthetic account link",
        }
      );
    }
  });

/**
 * Deletes exactly one journaled synthetic account the way account deletion
 * does: leaves the customer account's tombstone, so the reservations it
 * authored that cleanup keeps name a deleted account, then deletes the
 * Better Auth user. Cascades remove the account's sessions, OAuth accounts,
 * and the customer-account link row. Repeats keep the first deletion instant.
 */
export const removeSyntheticAuthUser = (
  accountId: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "tombstone synthetic customer account",
      CustomerAccountRepository.use((accounts) =>
        accounts.tombstone(
          customerAccountIdSchema.make(accountId),
          Temporal.Now.instant()
        )
      ).pipe(
        Effect.provide(CustomerAccountRepository.Default),
        Effect.provideService(WorkspaceDatabase, WorkspaceDatabase.make(db))
      )
    );
    yield* runDatabaseOperation(
      "delete synthetic auth user",
      db.delete(authUser).where(eq(authUser.id, accountId))
    );
  });

export const setDeletionRequestedAt = (
  accountId: string,
  value: Date | null
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "set synthetic deletion marker",
      db
        .update(authUser)
        .set({ deletionRequestedAt: value })
        .where(eq(authUser.id, accountId))
    );
  });

/**
 * Sets the saved locale preference of the exact synthetic account. A
 * deletion-pending account keeps its preference but rejects every save
 * through the application, so the lane uses this fixture to give the
 * pending account a preference its reauthentication sign-in must honor.
 */
export const setAccountLocalePreference = (
  accountId: string,
  locale: Locale
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "set synthetic account locale preference",
      db.update(authUser).set({ locale }).where(eq(authUser.id, accountId))
    );
  });

/**
 * Back-dates or restores the creation time of the synthetic account's own
 * sessions so the deployed ten-minute recent-session deletion gate is
 * exercised deterministically. Only the exact synthetic user's rows change.
 */
export const setSessionCreatedAt = (
  accountId: string,
  value: Date
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "set synthetic session creation time",
      db
        .update(authSession)
        .set({ createdAt: value })
        .where(eq(authSession.userId, accountId))
    );
  });

/**
 * The number of passkeys the synthetic account holds. Only the exact
 * synthetic user's rows are counted.
 */
export const countAccountPasskeys = (
  accountId: string
): Effect.Effect<number, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "count synthetic account passkeys",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(authPasskey)
        .where(eq(authPasskey.userId, accountId))
    );
    return rows[0]?.count ?? 0;
  });

/**
 * When the synthetic account's newest session was created, so a passkey
 * reauthentication can be shown to have opened a fresh one.
 */
export const readNewestSessionCreatedAt = (
  accountId: string
): Effect.Effect<Date | undefined, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "read synthetic newest session creation time",
      db
        .select({ createdAt: sql<Date>`max(${authSession.createdAt})` })
        .from(authSession)
        .where(eq(authSession.userId, accountId))
    );
    const value = rows[0]?.createdAt;
    return value == null ? undefined : new Date(value);
  });

export const assertNoAuthRows = (
  accountId: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const users = yield* runDatabaseOperation(
      "count synthetic auth users",
      db
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.id, accountId))
    );
    const sessions = yield* runDatabaseOperation(
      "count synthetic auth sessions",
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(authSession)
        .where(eq(authSession.userId, accountId))
    );
    if (users.length > 0 || (sessions[0]?.count ?? 0) > 0) {
      return yield* workspaceE2EError(
        "Synthetic auth rows survived identity removal",
        {
          diagnosticCode: "postgres_account_fixture_assertion_failed",
          operation: "assert synthetic auth rows removed",
        }
      );
    }
  });

/**
 * Closed low-cardinality state of one synthetic account: whether the Better
 * Auth identity exists and whether profile completion committed its
 * customer-account link. These values are the diagnostic's only output.
 */
export type WorkspaceE2EAccountState = "linked" | "missing" | "unlinked";

const classifyWorkspaceE2EAccountState = (input: {
  readonly authUserId: string | undefined;
  readonly linkedDotyposCustomerId: string | undefined;
}): WorkspaceE2EAccountState => {
  if (!input.authUserId) return "missing";
  return input.linkedDotyposCustomerId ? "linked" : "unlinked";
};

/**
 * Classifies the exact synthetic account for one recipient. The read is
 * keyed by that recipient's unique email and joins only its own link row;
 * it never scans or returns broader production-derived rows.
 */
export const readSyntheticAccountState = (
  email: string
): Effect.Effect<WorkspaceE2EAccountState, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runRetrySafeDatabaseOperation(
      "read synthetic account state",
      db
        .select({
          authUserId: authUser.id,
          dotyposCustomerId: customerAccounts.dotyposCustomerId,
        })
        .from(authUser)
        .leftJoin(customerAccounts, eq(customerAccounts.id, authUser.id))
        .where(eq(authUser.email, email))
    );
    const row = rows[0];
    return classifyWorkspaceE2EAccountState({
      authUserId: row?.authUserId,
      linkedDotyposCustomerId: row?.dotyposCustomerId ?? undefined,
    });
  });
