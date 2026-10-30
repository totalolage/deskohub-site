import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { eq, inArray } from "drizzle-orm";
import { Effect, Exit } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  fulfillmentStates,
  paymentStates,
  reservationStates,
  workspaceReservations,
} from "@/db/schema";
import { accountRoleGrants } from "@/db/schema/account-role-grants";
import { authUser } from "@/db/schema/auth";
import { customerAccounts } from "@/db/schema/customer-accounts";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import {
  fixtureReservationAuthorId,
  workspaceFixtures,
} from "./workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  withHeldTransaction,
} from "./workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const everyStage = reservationStates.flatMap((reservation) =>
  paymentStates.flatMap((payment) =>
    fulfillmentStates.map((fulfillment) => ({
      reservation,
      payment,
      fulfillment,
    }))
  )
);

describe.skipIf(!testDatabase)("workspace fixtures", () => {
  const database = () => testDatabase!.db;
  const fixtures = () => workspaceFixtures(database());

  /** Runs `use` inside a transaction the test begins and then rolls back. */
  const inRolledBackTransaction = async <A, E>(
    use: (db: WorkspaceDatabaseClient) => Effect.Effect<A, E>
  ) => {
    const connection = await testDatabase!.pool.connect();
    try {
      await connection.query("begin");
      return await Effect.runPromise(withHeldTransaction(connection, use));
    } finally {
      await connection.query("rollback").catch(() => {});
      connection.release();
    }
  };

  test("the database accepts a reservation at every stage", async () => {
    const results = await Effect.runPromise(
      Effect.forEach(everyStage, (stage) =>
        Effect.exit(fixtures().reservation({ stage })).pipe(
          Effect.map((exit) => ({ stage, exit }))
        )
      )
    );

    const rejected = results.flatMap(({ stage, exit }) =>
      Exit.isFailure(exit) ? [{ stage, cause: String(exit.cause) }] : []
    );
    expect(rejected).toEqual([]);

    const stored = results.flatMap(({ exit }) =>
      Exit.isSuccess(exit) ? [exit.value] : []
    );
    expect(
      stored.map(
        ({
          reservationState,
          paymentState,
          fulfillmentState,
          authorAccountId,
        }) => ({
          reservation: reservationState,
          payment: paymentState,
          fulfillment: fulfillmentState,
          author: authorAccountId,
        })
      )
    ).toEqual(
      everyStage.map((stage) => ({
        ...stage,
        author: fixtureReservationAuthorId,
      }))
    );
  });

  test("overrides win over the stage's columns", async () => {
    const customer = DotyposCustomerIdSchema.make(
      `fixture-override-${crypto.randomUUID()}`
    );
    const paidAt = Temporal.Instant.from("2026-01-02T03:04:05Z");
    const dotyposReservationId = DotyposReservationIdSchema.make(
      `fixture-override-${crypto.randomUUID()}`
    );
    const reservation = await Effect.runPromise(
      fixtures().reservation({
        stage: { reservation: "confirmed", payment: "paid" },
        customer,
        locale: "cs-CZ",
        overrides: { paidAt, dotyposReservationId },
      })
    );

    expect(reservation).toMatchObject({
      dotyposCustomerId: customer,
      locale: "cs-CZ",
      paymentState: "paid",
      dotyposReservationId,
    });
    expect(reservation.paidAt?.equals(paidAt)).toBe(true);
  });

  test("an account is inserted with its login, link, and roles", async () => {
    const customer = DotyposCustomerIdSchema.make(
      `fixture-account-${crypto.randomUUID()}`
    );
    const createdAt = Temporal.Instant.from("2026-02-03T04:05:06Z");
    const loginCreatedAt = Temporal.Instant.from("2026-01-02T03:04:05Z");
    const account = await Effect.runPromise(
      fixtures().account("fixture-administrator", {
        verified: false,
        deletionRequested: true,
        legacy: true,
        linkedCustomer: customer,
        roles: ["administrator"],
        locale: "cs-CZ",
        createdAt,
        loginCreatedAt,
      })
    );

    const [stored] = await Effect.runPromise(
      database()
        .select({
          email: authUser.email,
          emailVerified: authUser.emailVerified,
          deletionRequestedAt: authUser.deletionRequestedAt,
          locale: authUser.locale,
          loginCreatedAt: authUser.createdAt,
          dotyposCustomerId: customerAccounts.dotyposCustomerId,
          legacy: customerAccounts.legacy,
          createdAt: customerAccounts.createdAt,
        })
        .from(authUser)
        .innerJoin(customerAccounts, eq(customerAccounts.id, authUser.id))
        .where(eq(authUser.id, account.accountId))
    );
    expect(stored).toMatchObject({
      email: account.email,
      emailVerified: false,
      locale: "cs-CZ",
      dotyposCustomerId: customer,
      legacy: true,
    });
    expect(stored?.deletionRequestedAt).toBeInstanceOf(Date);
    expect(stored?.createdAt.equals(createdAt)).toBe(true);
    expect(stored?.loginCreatedAt.getTime()).toBe(
      loginCreatedAt.epochMilliseconds
    );
    const grants = await Effect.runPromise(
      database()
        .select({ role: accountRoleGrants.role })
        .from(accountRoleGrants)
        .where(eq(accountRoleGrants.accountId, account.accountId))
    );
    expect(grants).toEqual([{ role: "administrator" }]);
  });

  test("deleting accounts removes their logins and grants but keeps the customer accounts", async () => {
    const account = await Effect.runPromise(
      fixtures().account("fixture-deleted", { roles: ["administrator"] })
    );
    const reservation = await Effect.runPromise(
      fixtures().reservation({
        stage: { reservation: "held" },
        author: account.accountId,
      })
    );

    await Effect.runPromise(fixtures().deleteAccounts([account]));

    const [logins, grants, customerAccountRows] = await Effect.runPromise(
      Effect.all([
        database()
          .select()
          .from(authUser)
          .where(eq(authUser.id, account.accountId)),
        database()
          .select()
          .from(accountRoleGrants)
          .where(eq(accountRoleGrants.accountId, account.accountId)),
        database()
          .select({ id: customerAccounts.id })
          .from(customerAccounts)
          .where(eq(customerAccounts.id, account.accountId)),
      ])
    );
    expect(logins).toEqual([]);
    expect(grants).toEqual([]);
    expect(customerAccountRows).toEqual([{ id: account.accountId }]);
    const [authored] = await Effect.runPromise(
      database()
        .select({ author: workspaceReservations.authorAccountId })
        .from(workspaceReservations)
        .where(eq(workspaceReservations.id, reservation.id))
    );
    expect(authored).toEqual({ author: account.accountId });
  });
  test("a batch larger than one statement is stored in input order", async () => {
    const customers = Array.from({ length: 1001 }, (_, index) =>
      DotyposCustomerIdSchema.make(
        `fixture-batch-${index}-${crypto.randomUUID()}`
      )
    );
    const stored = await Effect.runPromise(
      fixtures().reservations(
        customers.map((customer) => ({
          stage: { reservation: "confirmed", payment: "paid" },
          customer,
        }))
      )
    );

    expect(stored.map(({ dotyposCustomerId }) => dotyposCustomerId)).toEqual(
      customers
    );
  });

  test("a customer account without a login can be a tombstone", async () => {
    const deletedAt = Temporal.Instant.from("2026-01-02T03:04:05Z");
    const accountId = await Effect.runPromise(
      fixtures().customerAccount({ deletedAt })
    );

    const [stored] = await Effect.runPromise(
      database()
        .select({ deletedAt: customerAccounts.deletedAt })
        .from(customerAccounts)
        .where(eq(customerAccounts.id, accountId))
    );
    expect(stored?.deletedAt?.equals(deletedAt)).toBe(true);
    const logins = await Effect.runPromise(
      database().select().from(authUser).where(eq(authUser.id, accountId))
    );
    expect(logins).toEqual([]);
  });
  test("a role granted later records its grantor", async () => {
    const grantor = await Effect.runPromise(
      fixtures().account("fixture-grantor", { roles: ["administrator"] })
    );
    const grantee = await Effect.runPromise(
      fixtures().account("fixture-grantee")
    );

    await Effect.runPromise(
      fixtures().grantRole(grantee.accountId, "administrator", {
        grantedBy: grantor.accountId,
      })
    );

    const grants = await Effect.runPromise(
      database()
        .select({
          role: accountRoleGrants.role,
          grantedBy: accountRoleGrants.grantedByAccountId,
        })
        .from(accountRoleGrants)
        .where(eq(accountRoleGrants.accountId, grantee.accountId))
    );
    expect(grants).toEqual([
      { role: "administrator", grantedBy: grantor.accountId },
    ]);
  });

  test("fixtures written inside a transaction the test holds roll back with it", async () => {
    const { accountIds, reservationId } = await inRolledBackTransaction((db) =>
      Effect.gen(function* () {
        const held = workspaceFixtures(db);
        const grantor = yield* held.account("fixture-held-grantor", {
          roles: ["administrator"],
        });
        const grantee = yield* held.account("fixture-held-grantee");
        yield* held.grantRole(grantee.accountId, "administrator", {
          grantedBy: grantor.accountId,
        });
        const reservation = yield* held.reservation({
          stage: { reservation: "draft" },
        });
        return {
          accountIds: [grantor.accountId, grantee.accountId],
          reservationId: reservation.id,
        };
      })
    );

    const remaining = await Effect.runPromise(
      Effect.all({
        accounts: database()
          .select({ id: customerAccounts.id })
          .from(customerAccounts)
          .where(inArray(customerAccounts.id, accountIds)),
        logins: database()
          .select({ id: authUser.id })
          .from(authUser)
          .where(inArray(authUser.id, accountIds)),
        grants: database()
          .select({ role: accountRoleGrants.role })
          .from(accountRoleGrants)
          .where(inArray(accountRoleGrants.accountId, accountIds)),
        reservations: database()
          .select({ id: workspaceReservations.id })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, reservationId)),
      })
    );
    expect(remaining).toEqual({
      accounts: [],
      logins: [],
      grants: [],
      reservations: [],
    });
  });

  test("an account whose login fails leaves no customer account", async () => {
    const taken = await Effect.runPromise(
      fixtures().account("fixture-login-taken")
    );
    const id = customerAccountIdSchema.make(crypto.randomUUID());
    const exit = await Effect.runPromise(
      Effect.exit(
        fixtures().account("fixture-login-duplicate", {
          id,
          email: taken.email,
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const accounts = await Effect.runPromise(
      database()
        .select({ id: customerAccounts.id })
        .from(customerAccounts)
        .where(eq(customerAccounts.id, id))
    );
    expect(accounts).toEqual([]);
  });

  test("a fixture that fails inside a held transaction leaves the transaction usable", async () => {
    const outcome = await inRolledBackTransaction((db) =>
      Effect.gen(function* () {
        const held = workspaceFixtures(db);
        const { accountId } = yield* held.account("fixture-held-original");
        const duplicate = yield* Effect.exit(
          held.account("fixture-held-duplicate", { id: accountId })
        );
        const reservation = yield* held.reservation({
          stage: { reservation: "draft" },
        });
        return { duplicateFailed: Exit.isFailure(duplicate), reservation };
      })
    );

    expect(outcome.duplicateFailed).toBe(true);
    expect(outcome.reservation.reservationState).toBe("draft");
  });
});
