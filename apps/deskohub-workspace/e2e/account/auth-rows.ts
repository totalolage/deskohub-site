import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { authSession, authUser } from "@/db/schema/auth";
import { customerAccountLinks } from "@/db/schema/customer-account-links";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
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

export const findLinkedDotyposCustomerId = (
  accountId: string
): Effect.Effect<string | undefined, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const rows = yield* runDatabaseOperation(
      "read synthetic account link",
      db
        .select({
          dotyposCustomerId: customerAccountLinks.dotyposCustomerId,
        })
        .from(customerAccountLinks)
        .where(eq(customerAccountLinks.customerAccountId, accountId))
    );
    return rows[0]?.dotyposCustomerId;
  });

/**
 * Deletes exactly one journaled synthetic Better Auth user. Cascades remove
 * the account's sessions, OAuth accounts, and the customer-account link row.
 */
export const removeSyntheticAuthUser = (
  accountId: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
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

export const classifyWorkspaceE2EAccountState = (input: {
  readonly authUserId: string | undefined;
  readonly linkedDotyposCustomerId: string | undefined;
}): WorkspaceE2EAccountState =>
  !input.authUserId
    ? "missing"
    : input.linkedDotyposCustomerId
      ? "linked"
      : "unlinked";

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
          dotyposCustomerId: customerAccountLinks.dotyposCustomerId,
        })
        .from(authUser)
        .leftJoin(
          customerAccountLinks,
          eq(customerAccountLinks.customerAccountId, authUser.id)
        )
        .where(eq(authUser.email, sensitiveDatabaseParameter(email)))
    );
    const row = rows[0];
    return classifyWorkspaceE2EAccountState({
      authUserId: row?.authUserId,
      linkedDotyposCustomerId: row?.dotyposCustomerId ?? undefined,
    });
  });
