import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import {
  fulfillmentStates,
  paymentStates,
  reservationStates,
  workspaceReservations,
} from "@/db/schema";
import { accountRoleGrants } from "@/db/schema/account-role-grants";
import { authUser } from "@/db/schema/auth";
import { customerAccounts } from "@/db/schema/customer-accounts";
import {
  fixtureReservationAuthorId,
  type ReservationFixtureStage,
  workspaceFixtures,
} from "./workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "./workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const everyStage: readonly ReservationFixtureStage[] =
  reservationStates.flatMap((reservation) =>
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
    const account = await Effect.runPromise(
      fixtures().account("fixture-administrator", {
        verified: false,
        deletionRequested: true,
        linkedCustomer: customer,
        roles: ["administrator"],
        locale: "cs-CZ",
      })
    );

    const [stored] = await Effect.runPromise(
      database()
        .select({
          email: authUser.email,
          emailVerified: authUser.emailVerified,
          deletionRequestedAt: authUser.deletionRequestedAt,
          locale: authUser.locale,
          dotyposCustomerId: customerAccounts.dotyposCustomerId,
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
    });
    expect(stored?.deletionRequestedAt).toBeInstanceOf(Date);
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
});
