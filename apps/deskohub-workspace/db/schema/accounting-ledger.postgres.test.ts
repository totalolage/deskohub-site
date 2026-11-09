import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { PoolClient } from "pg";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  withHeldTransaction,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

type DatabaseRejection = { readonly code?: string; readonly message: string };

const objectNotInPrerequisiteState = "55000";
const checkViolation = "23514";

describe.skipIf(!testDatabase)(
  "issued accounting documents on disposable Postgres",
  () => {
    if (!testDatabase) return;

    // Every scenario runs in one transaction that is always rolled back.
    const inRolledBackTransaction = async (
      scenario: (client: PoolClient) => Promise<void>
    ) => {
      const client = await testDatabase.pool.connect();
      try {
        await client.query("begin");
        await scenario(client);
      } finally {
        await client.query("rollback");
        client.release();
      }
    };

    const rejectionOf = async (
      client: PoolClient,
      statement: string,
      params: readonly unknown[]
    ): Promise<DatabaseRejection | undefined> => {
      await client.query("savepoint attempt");
      try {
        await client.query(statement, [...params]);
        return undefined;
      } catch (error) {
        return error as DatabaseRejection;
      } finally {
        await client.query("rollback to savepoint attempt");
      }
    };

    let sequence = 0;
    const nextId = (prefix: string) =>
      `${prefix}-${crypto.randomUUID()}-${++sequence}`;

    /** A paid reservation whose active paid attempt has a snapshot. */
    const seedPaidReservation = async (
      client: PoolClient,
      input: { readonly attemptState?: "paid" | "failed" } = {}
    ) => {
      const attemptId = nextId("synthetic-attempt");
      const attemptState = input.attemptState ?? "paid";
      const { id: reservationId, dotyposCustomerId: customerId } =
        await Effect.runPromise(
          withHeldTransaction(client, (db) =>
            workspaceFixtures(db).reservation({
              stage: { reservation: "draft", payment: attemptState },
            })
          )
        );
      await client.query(
        `insert into payment_attempts (
          id, workspace_reservation_id, provider, state, amount_value,
          amount_exponent, currency, provider_order_id, failure_code
        ) values ($1, $2, 'nexi', $3, 1000, 2, 'CZK', $4, $5)`,
        [
          attemptId,
          reservationId,
          attemptState,
          nextId("synthetic-order"),
          attemptState === "failed" ? "synthetic_failure" : null,
        ]
      );
      await client.query(
        "update workspace_reservations set active_payment_attempt_id = $1 where id = $2",
        [attemptId, reservationId]
      );
      await client.query(
        `insert into accounting_document_snapshots (
          payment_attempt_id, workspace_reservation_id, key_id, encrypted_snapshot
        ) values ($1, $2, 'SYNTHETIC_KEY', '\\x00'::bytea)`,
        [attemptId, reservationId]
      );
      return { attemptId, customerId, reservationId };
    };

    const insertInvoice = `insert into invoices (
        id, dotypos_customer_id, invoice_number, numbering_year,
        numbering_sequence, key_id, encrypted_document, issued_at,
        workspace_reservation_id, payment_attempt_id
      ) values ($1, $2, $3, 2099, $4, 'SYNTHETIC_KEY', '\\x00'::bytea,
        '2099-06-01T10:00:00Z', $5, $6)`;

    const invoiceParams = (source: {
      readonly customerId: string;
      readonly reservationId?: string | null;
      readonly attemptId?: string | null;
    }) => {
      sequence += 1;
      return [
        nextId("synthetic-invoice"),
        source.customerId,
        `SYN-2099-${sequence}`,
        sequence,
        source.reservationId ?? null,
        source.attemptId ?? null,
      ];
    };

    test("rejects updating or deleting an accounting document snapshot", async () => {
      await inRolledBackTransaction(async (client) => {
        const { attemptId } = await seedPaidReservation(client);

        const update = await rejectionOf(
          client,
          "update accounting_document_snapshots set key_id = 'OTHER_KEY' where payment_attempt_id = $1",
          [attemptId]
        );
        const deletion = await rejectionOf(
          client,
          "delete from accounting_document_snapshots where payment_attempt_id = $1",
          [attemptId]
        );

        expect(update?.code).toBe(objectNotInPrerequisiteState);
        expect(deletion?.code).toBe(objectNotInPrerequisiteState);
      });
    });

    test("releases the snapshot of an unsuccessful attempt", async () => {
      await inRolledBackTransaction(async (client) => {
        const { attemptId } = await seedPaidReservation(client, {
          attemptState: "failed",
        });

        expect(
          await rejectionOf(
            client,
            "delete from accounting_document_snapshots where payment_attempt_id = $1",
            [attemptId]
          )
        ).toBeUndefined();
      });
    });

    test("accepts a manual invoice and one sourced from the active paid attempt", async () => {
      await inRolledBackTransaction(async (client) => {
        const source = await seedPaidReservation(client);

        expect(
          await rejectionOf(
            client,
            insertInvoice,
            invoiceParams({ customerId: nextId("synthetic-manual-customer") })
          )
        ).toBeUndefined();
        expect(
          await rejectionOf(client, insertInvoice, invoiceParams(source))
        ).toBeUndefined();
      });
    });

    test("rejects updating or deleting an issued invoice", async () => {
      await inRolledBackTransaction(async (client) => {
        const source = await seedPaidReservation(client);
        const params = invoiceParams(source);
        await client.query(insertInvoice, params);

        const update = await rejectionOf(
          client,
          "update invoices set key_id = 'OTHER_KEY' where id = $1",
          [params[0]]
        );
        const deletion = await rejectionOf(
          client,
          "delete from invoices where id = $1",
          [params[0]]
        );

        expect(update?.code).toBe(objectNotInPrerequisiteState);
        expect(deletion?.code).toBe(objectNotInPrerequisiteState);
      });
    });

    test("rejects invoices whose source is not the active paid attempt of the customer's paid reservation", async () => {
      await inRolledBackTransaction(async (client) => {
        const source = await seedPaidReservation(client);
        const otherSource = await seedPaidReservation(client);
        const unpaid = await seedPaidReservation(client, {
          attemptState: "failed",
        });

        const attempts = [
          // Another customer's identity on this reservation's invoice.
          invoiceParams({ ...source, customerId: otherSource.customerId }),
          // An attempt that belongs to a different reservation.
          invoiceParams({ ...source, attemptId: otherSource.attemptId }),
          // A reservation that was never paid.
          invoiceParams(unpaid),
          // Half a source reference.
          invoiceParams({ ...source, attemptId: null }),
        ];
        const codes: (string | undefined)[] = [];
        for (const params of attempts) {
          codes.push((await rejectionOf(client, insertInvoice, params))?.code);
        }

        expect(codes).toEqual([
          checkViolation,
          checkViolation,
          checkViolation,
          checkViolation,
        ]);
      });
    });

    test("rejects an invoice for a paid attempt the reservation no longer has active", async () => {
      await inRolledBackTransaction(async (client) => {
        const superseded = await seedPaidReservation(client);
        const activeAttemptId = nextId("synthetic-attempt");
        await client.query(
          `insert into payment_attempts (
            id, workspace_reservation_id, provider, state, amount_value,
            amount_exponent, currency, provider_order_id
          ) values ($1, $2, 'nexi', 'paid', 1000, 2, 'CZK', $3)`,
          [activeAttemptId, superseded.reservationId, nextId("synthetic-order")]
        );
        await client.query(
          `insert into accounting_document_snapshots (
            payment_attempt_id, workspace_reservation_id, key_id, encrypted_snapshot
          ) values ($1, $2, 'SYNTHETIC_KEY', '\\x00'::bytea)`,
          [activeAttemptId, superseded.reservationId]
        );
        await client.query(
          "update workspace_reservations set active_payment_attempt_id = $1 where id = $2",
          [activeAttemptId, superseded.reservationId]
        );

        // Same reservation, customer, paid state, and snapshot; only the
        // active attempt differs.
        const supersededRejection = await rejectionOf(
          client,
          insertInvoice,
          invoiceParams(superseded)
        );
        const activeRejection = await rejectionOf(
          client,
          insertInvoice,
          invoiceParams({ ...superseded, attemptId: activeAttemptId })
        );

        expect(supersededRejection?.code).toBe(checkViolation);
        expect(activeRejection).toBeUndefined();
      });
    });
  }
);
