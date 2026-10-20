import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  customerAccountLinks,
  customerAccounts,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";
import {
  accountLoginMissing,
  accountSettled,
  recordCustomerAccountLink,
} from "./customer-account.repository";

/**
 * The reads and writes of the account backfill. Every function takes the
 * executor it runs on, so the service can join them into one transaction.
 */

const decodeAccountIds = Schema.decodeUnknownEffect(
  Schema.Array(customerAccountIdSchema)
);

const count = sql<number>`count(*)::int`;

/** Logins whose durable customer account was never created. */
export const findLoginsWithoutAccount = Effect.fn(function* (
  db: WorkspaceDatabaseClient
) {
  const rows = yield* db
    .select({ id: authUser.id })
    .from(authUser)
    .leftJoin(customerAccounts, eq(customerAccounts.id, authUser.id))
    .where(isNull(customerAccounts.id))
    .orderBy(authUser.id);
  return yield* decodeAccountIds(rows.map(({ id }) => id));
});

export const countLoginsWithAccount = Effect.fn(function* (
  db: WorkspaceDatabaseClient
) {
  const [row] = yield* db
    .select({ count })
    .from(authUser)
    .innerJoin(customerAccounts, eq(customerAccounts.id, authUser.id));
  return row?.count ?? 0;
});

/** Creates the missing accounts and returns how many it created. */
export const createAccounts = Effect.fn(function* (
  db: WorkspaceDatabaseClient,
  accountIds: readonly CustomerAccountId[]
) {
  if (accountIds.length === 0) return 0;
  const created = yield* db
    .insert(customerAccounts)
    .values(accountIds.map((id) => ({ id })))
    .onConflictDoNothing()
    .returning({ id: customerAccounts.id });
  return created.length;
});

export type LinkRecordState =
  | "recorded"
  | "pending"
  /**
   * The account is deleted, its record names another customer, or another
   * live account holds the customer.
   */
  | "conflict";

/**
 * Every link row with whether the linked account's record already names its
 * customer. Without `accountId` it reads all of them.
 */
export const readLinkRecordStates = Effect.fn(function* (
  db: WorkspaceDatabaseClient,
  accountId?: CustomerAccountId
) {
  const holder = alias(customerAccounts, "holder");
  const rows = yield* db
    .select({
      accountId: customerAccountLinks.customerAccountId,
      customerId: customerAccountLinks.dotyposCustomerId,
      recordedCustomerId: customerAccounts.dotyposCustomerId,
      deletedAt: customerAccounts.deletedAt,
      heldByOtherAccount: sql<boolean>`exists (${db
        .select({ id: holder.id })
        .from(holder)
        .where(
          and(
            eq(
              holder.dotyposCustomerId,
              customerAccountLinks.dotyposCustomerId
            ),
            ne(holder.id, customerAccountLinks.customerAccountId),
            isNull(holder.deletedAt)
          )
        )})`,
    })
    .from(customerAccountLinks)
    .leftJoin(
      customerAccounts,
      eq(customerAccounts.id, customerAccountLinks.customerAccountId)
    )
    .where(
      accountId === undefined
        ? undefined
        : eq(customerAccountLinks.customerAccountId, accountId)
    )
    .orderBy(customerAccountLinks.customerAccountId);
  const accountIds = yield* decodeAccountIds(rows.map((row) => row.accountId));
  const stateOf = (row: (typeof rows)[number]): LinkRecordState => {
    if (row.recordedCustomerId === row.customerId) return "recorded";
    return row.deletedAt !== null ||
      row.recordedCustomerId !== null ||
      row.heldByOtherAccount
      ? "conflict"
      : "pending";
  };
  return rows.map((row, index) => {
    const state = stateOf(row);
    return {
      accountId: accountIds[index] as CustomerAccountId,
      customerId: row.customerId,
      state,
    };
  });
});

/**
 * Live accounts whose login is gone: the settled ones a run tombstones, how
 * many are too recent, and how many accounts are already deleted.
 */
export const findOrphanedAccounts = Effect.fn(function* (
  db: WorkspaceDatabaseClient
) {
  const orphans = yield* db
    .select({
      id: customerAccounts.id,
      settled: sql<boolean>`${accountSettled()}`,
    })
    .from(customerAccounts)
    .where(and(isNull(customerAccounts.deletedAt), accountLoginMissing(db)))
    .orderBy(customerAccounts.id);
  const [deleted] = yield* db
    .select({ count })
    .from(customerAccounts)
    .where(isNotNull(customerAccounts.deletedAt));
  return {
    settled: yield* decodeAccountIds(
      orphans.flatMap(({ id, settled }) => (settled ? [id] : []))
    ),
    recent: orphans.filter(({ settled }) => !settled).length,
    alreadyDeleted: deleted?.count ?? 0,
  };
});

/** One Dotypos customer that has reservations without an author. */
export type AuthorlessCustomer = {
  readonly customerId: DotyposCustomerId;
  readonly reservations: number;
  /** The locale of the customer's latest authorless reservation. */
  readonly latestLocale: string;
};

export const readAuthorlessCustomers = (db: WorkspaceDatabaseClient) =>
  db
    .select({
      customerId: workspaceReservations.dotyposCustomerId,
      reservations: count,
      latestLocale: sql<string>`(array_agg(${workspaceReservations.locale} order by ${workspaceReservations.createdAt} desc, ${workspaceReservations.id} desc))[1]`,
    })
    .from(workspaceReservations)
    .where(isNull(workspaceReservations.authorAccountId))
    .groupBy(workspaceReservations.dotyposCustomerId)
    .orderBy(workspaceReservations.dotyposCustomerId)
    .pipe(Effect.map((rows): readonly AuthorlessCustomer[] => rows));

export const countAuthoredReservations = Effect.fn(function* (
  db: WorkspaceDatabaseClient
) {
  const [row] = yield* db
    .select({ count })
    .from(workspaceReservations)
    .where(isNotNull(workspaceReservations.authorAccountId));
  return row?.count ?? 0;
});

/** One account-to-customer link, from either place that records it. */
export type CustomerLink = {
  readonly accountId: CustomerAccountId;
  readonly customerId: DotyposCustomerId;
  readonly accountDeleted: boolean;
};

/**
 * Every Dotypos link, or the ones that name `scope`'s customer or account.
 * Until the contract release drops `customer_account_links`, a link counts
 * when either the live account's record or a link row names it; the
 * contract release reads the record alone.
 */
export const readCustomerLinks = Effect.fn(function* (
  db: WorkspaceDatabaseClient,
  scope?: {
    readonly customerId: DotyposCustomerId;
    readonly accountId: CustomerAccountId;
  }
) {
  const recorded = yield* db
    .select({
      accountId: customerAccounts.id,
      customerId: customerAccounts.dotyposCustomerId,
    })
    .from(customerAccounts)
    .where(
      and(
        isNotNull(customerAccounts.dotyposCustomerId),
        isNull(customerAccounts.deletedAt),
        scope &&
          or(
            eq(customerAccounts.dotyposCustomerId, scope.customerId),
            eq(customerAccounts.id, scope.accountId)
          )
      )
    );
  const linked = yield* db
    .select({
      accountId: customerAccountLinks.customerAccountId,
      customerId: customerAccountLinks.dotyposCustomerId,
      deletedAt: customerAccounts.deletedAt,
    })
    .from(customerAccountLinks)
    .leftJoin(
      customerAccounts,
      eq(customerAccounts.id, customerAccountLinks.customerAccountId)
    )
    .where(
      scope &&
        or(
          eq(customerAccountLinks.dotyposCustomerId, scope.customerId),
          eq(customerAccountLinks.customerAccountId, scope.accountId)
        )
    );
  const linkedAccountIds = yield* decodeAccountIds(
    linked.map((row) => row.accountId)
  );
  return [
    ...recorded.flatMap(({ accountId, customerId }): CustomerLink[] =>
      customerId === null
        ? []
        : [{ accountId, customerId, accountDeleted: false }]
    ),
    ...linked.map(
      ({ customerId, deletedAt }, index): CustomerLink => ({
        accountId: linkedAccountIds[index] as CustomerAccountId,
        customerId,
        accountDeleted: deletedAt !== null,
      })
    ),
  ];
});

/** A login whose email matches one of the customers' emails. */
export type EmailLogin = {
  readonly accountId: CustomerAccountId;
  /** The login email in its compared form. */
  readonly emailIdentity: string;
  readonly emailVerified: boolean;
};

/** Logins whose lowercased email is one of `emailIdentities`. */
export const readLoginsByEmail = Effect.fn(function* (
  db: WorkspaceDatabaseClient,
  emailIdentities: readonly string[]
) {
  if (emailIdentities.length === 0) return [];
  const emailIdentity = sql<string>`lower(${authUser.email})`;
  const rows = yield* db
    .select({
      accountId: authUser.id,
      emailIdentity,
      emailVerified: authUser.emailVerified,
    })
    .from(authUser)
    .where(inArray(emailIdentity, [...emailIdentities]));
  const accountIds = yield* decodeAccountIds(rows.map((row) => row.accountId));
  return rows.map(
    (row, index): EmailLogin => ({
      accountId: accountIds[index] as CustomerAccountId,
      emailIdentity: row.emailIdentity,
      emailVerified: row.emailVerified,
    })
  );
});

/** Whether the account's login is verified, or undefined when it is gone. */
export const readLoginVerified = Effect.fn(function* (
  db: WorkspaceDatabaseClient,
  accountId: CustomerAccountId
) {
  const [login] = yield* db
    .select({ emailVerified: authUser.emailVerified })
    .from(authUser)
    .where(eq(authUser.id, accountId));
  return login?.emailVerified;
});

/**
 * Links an account created by the backfill to its customer, in the
 * caller's transaction under the account lock. Unlike a sign-in claim it
 * records no account-created event and no referral: the login stays silent
 * until its owner verifies it. Returns false when the account or the
 * customer is already linked.
 */
export const linkBackfilledAccount = Effect.fn(function* (
  tx: WorkspaceDatabaseClient,
  accountId: CustomerAccountId,
  customerId: DotyposCustomerId
) {
  const [link] = yield* tx
    .insert(customerAccountLinks)
    .values({ customerAccountId: accountId, dotyposCustomerId: customerId })
    .onConflictDoNothing()
    .returning({ accountId: customerAccountLinks.customerAccountId });
  if (!link) return false;
  yield* recordCustomerAccountLink(tx, accountId, customerId);
  return true;
});

/**
 * Makes the account the author of the customer's reservations that have
 * none, and returns how many it changed. Recorded authors never change, and
 * `updated_at` stays as it is because it orders admin activity.
 */
export const assignAuthorlessReservations = Effect.fn(function* (
  tx: WorkspaceDatabaseClient,
  customerId: DotyposCustomerId,
  accountId: CustomerAccountId
) {
  const rows = yield* tx
    .update(workspaceReservations)
    .set({ authorAccountId: accountId })
    .where(
      and(
        eq(workspaceReservations.dotyposCustomerId, customerId),
        isNull(workspaceReservations.authorAccountId)
      )
    )
    .returning({ id: workspaceReservations.id });
  return rows.length;
});
