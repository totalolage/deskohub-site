import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { AdministrationInvoiceId } from "@deskohub/workspace-admin-api";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { invoices } from "@/db/schema";
import {
  connectWorkspacePostgresTestDatabase,
  withHeldTransaction,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { InvoiceBreadcrumbService } from "./invoice-breadcrumb.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "InvoiceBreadcrumbService on disposable Postgres",
  () => {
    test("names a stored invoice by its number and nothing for an unknown one", async () => {
      const invoiceNumber = `synthetic-breadcrumb-${crypto.randomUUID()}`;
      // Invoices are never deleted, so the row stays in a transaction that
      // rolls back.
      const connection = await testDatabase!.pool.connect();
      try {
        await connection.query("begin");
        const labels = await Effect.runPromise(
          withHeldTransaction(connection, (db) =>
            Effect.gen(function* () {
              const [stored] = yield* db
                .insert(invoices)
                .values({
                  dotyposCustomerId: "synthetic-customer",
                  invoiceNumber,
                  numberingYear: 2026,
                  // Far beyond any sequence another suite issues.
                  numberingSequence:
                    1_000_000_000 + Math.floor(Math.random() * 1e9),
                  keyId: "SYNTHETIC_KEY",
                  encryptedDocument: Buffer.from("synthetic"),
                  issuedAt: Temporal.Instant.from("2026-06-01T12:00:00Z"),
                } as never)
                .returning({ id: invoices.id });
              const breadcrumb = yield* InvoiceBreadcrumbService;
              return {
                stored: yield* breadcrumb.getInvoiceNumber(
                  AdministrationInvoiceId.make(stored!.id)
                ),
                unknown: yield* breadcrumb.getInvoiceNumber(
                  AdministrationInvoiceId.make(crypto.randomUUID())
                ),
              };
            }).pipe(
              Effect.provide(
                InvoiceBreadcrumbService.Default.pipe(
                  Layer.provide(
                    Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(db))
                  )
                )
              )
            )
          )
        );

        expect(labels).toEqual({ stored: invoiceNumber, unknown: null });
      } finally {
        await connection.query("rollback");
        connection.release();
      }
    });
  }
);
