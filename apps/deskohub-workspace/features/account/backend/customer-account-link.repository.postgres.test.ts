import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  WorkspaceDatabaseAdvisoryLock,
  withPostgresAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import {
  AccountingSnapshotKeyError,
  AccountingSnapshotKeyService,
} from "@/features/accounting/backend/accounting-snapshot-key.service";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { makeTestManualInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { customerAccountIdSchema } from "../customer-account";
import { AccountFeatureFlagService } from "./account-feature-flag.service";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAccountResolver } from "./customer-account-resolver.service";

mock.module("server-only", () => ({}) as never);

const { CustomerInvoiceService } = await import("./customer-invoice.service");

const testDatabase = await connectWorkspacePostgresTestDatabase();

const makeRepositoryLayer = () =>
  CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          WorkspaceDatabase,
          WorkspaceDatabase.of({ db: testDatabase!.db })
        ),
        WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool)
      )
    )
  );

const insertAuthUser = async (id: string, email: string) => {
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, email]
  );
};

const uniqueId = () => crypto.randomUUID();

describe.skipIf(!testDatabase)(
  "CustomerAccountLinkRepository on disposable Postgres",
  () => {
    test("claims idempotently for the same account and rejects a second account", async () => {
      const layer = makeRepositoryLayer();
      const firstAccount = customerAccountIdSchema.make(uniqueId());
      const secondAccount = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();

      await insertAuthUser(firstAccount, `a-${firstAccount}@deskohub.test`);
      await insertAuthUser(secondAccount, `b-${secondAccount}@deskohub.test`);

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const firstClaim = yield* links.claim(
            firstAccount,
            dotyposCustomerId
          );
          const secondClaim = yield* links.claim(
            firstAccount,
            dotyposCustomerId
          );
          const rivalClaim = yield* Effect.result(
            links.claim(secondAccount, dotyposCustomerId)
          );
          return { firstClaim, secondClaim, rivalClaim };
        }).pipe(Effect.provide(layer))
      );

      expect(outcomes.firstClaim).toEqual({
        kind: "linked",
        customerId: dotyposCustomerId,
      });
      expect(outcomes.secondClaim).toEqual({
        kind: "linked",
        customerId: dotyposCustomerId,
      });
      expect(outcomes.rivalClaim._tag).toBe("Success");
      if (outcomes.rivalClaim._tag === "Success") {
        expect(outcomes.rivalClaim.success.kind).toBe("claimed");
      }
    });

    test("converges concurrent claims so exactly one link exists per account", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, `c-${account}@deskohub.test`);

      const claims = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const [first, second] = yield* Effect.all([
            links.claim(account, dotyposCustomerId),
            links.claim(account, dotyposCustomerId),
          ]);
          return [first, second];
        }).pipe(Effect.provide(layer))
      );

      for (const claim of claims) {
        expect(claim.kind).toBe("linked");
        if (claim.kind === "linked") {
          expect(claim.customerId).toBe(dotyposCustomerId);
        }
      }

      const rows = await testDatabase!.pool.query(
        `select dotypos_customer_id from customer_account_links where customer_account_id = $1`,
        [account]
      );
      expect(rows.rows).toHaveLength(1);
    });

    test("exposes the activity state and stops it once the auth account row is gone", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `d-${account}@deskohub.test`);
      await linkRow(account, uniqueDotyposId());

      const marker = new Date("2026-09-02T10:00:00.000Z");
      const states = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const initial = yield* links.findActivityState(account);
          yield* links.markDeletionRequested(account, marker);
          const marked = yield* links.findActivityState(account);
          return { initial, marked };
        }).pipe(Effect.provide(layer))
      );

      expect(states.initial).toEqual({
        kind: "active",
        deletionRequestedAt: null,
      });
      expect(states.marked.kind).toBe("active");
      if (states.marked.kind === "active") {
        expect(states.marked.deletionRequestedAt?.toISOString()).toBe(
          marker.toISOString()
        );
      }

      await testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
        account,
      ]);

      const afterDeletion = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          return yield* links.findActivityState(account);
        }).pipe(Effect.provide(layer))
      );
      expect(afterDeletion).toEqual({ kind: "missing" });

      const link = await testDatabase!.pool.query(
        `select * from customer_account_links where customer_account_id = $1`,
        [account]
      );
      expect(link.rows).toHaveLength(0);
    });

    test("serializes resolution against an outer account lock holder", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `e-${account}@deskohub.test`);

      let innerCompleted = false;

      await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const gate = yield* Deferred.make<never, void>();

          const outer = yield* Effect.forkChild(
            withPostgresAdvisoryLock(
              testDatabase!.pool,
              ["customer-account", account],
              Deferred.await(gate).pipe(Effect.orDie)
            ).pipe(Effect.orDie)
          );

          yield* Effect.sleep("150 millis");

          const inner = yield* Effect.forkChild(
            links
              .withAccountLock(
                account,
                Effect.sync(() => {
                  innerCompleted = true;
                })
              )
              .pipe(Effect.orDie)
          );

          yield* Effect.sleep("300 millis");
          expect(innerCompleted).toBe(false);

          yield* Deferred.succeed(gate, undefined);
          yield* Fiber.join(outer);
          yield* Fiber.join(inner);

          expect(innerCompleted).toBe(true);
        }).pipe(Effect.provide(layer))
      );
    });
  }
);

describe.skipIf(!testDatabase)(
  "customer invoice storage through identity deletion on disposable Postgres",
  () => {
    // Matches the invoice id and owner baked into the synthetic manual
    // invoice document so the repository's stored-document validation holds.
    const invoiceId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb23";
    const dotyposCustomerId = "dotypos-customer-manual";
    const keyId = "TEST_KEY_1";
    const keySecret = "synthetic-snapshot-secret";
    const issuedAt = "2026-08-12T12:34:56.789Z";
    const document = makeTestManualInvoiceDocument("en-US");

    const makeDbLayer = () =>
      Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db: testDatabase!.db })
      );
    const makeKeysLayer = () =>
      Layer.succeed(
        AccountingSnapshotKeyService,
        AccountingSnapshotKeyService.of({
          getActive: Effect.succeed({ id: keyId as never, secret: keySecret }),
          getById: (requested: string) =>
            requested === keyId
              ? Effect.succeed({ id: keyId as never, secret: keySecret })
              : Effect.fail(
                  new AccountingSnapshotKeyError({
                    keyId: requested,
                    message: "Synthetic key is unavailable.",
                  })
                ),
        } as never)
      );
    const makeInvoiceRepositoryLayer = () =>
      InvoiceRepository.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            makeDbLayer(),
            makeKeysLayer(),
            Layer.succeed(
              AccountingDocumentSnapshotRepository,
              AccountingDocumentSnapshotRepository.of({
                findByPaymentAttemptId: () =>
                  Effect.die("unused in these tests"),
              } as never)
            )
          )
        )
      );
    const makeInvoiceServiceLayer = (accountId: string) =>
      CustomerInvoiceService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            makeRepositoryLayer(),
            makeInvoiceRepositoryLayer(),
            Layer.succeed(
              AccountFeatureFlagService,
              AccountFeatureFlagService.of({
                isEnabled: Effect.succeed(true),
              } as never)
            ),
            Layer.succeed(
              CustomerAccountResolver,
              CustomerAccountResolver.of({
                resolve: Effect.succeed({
                  accountId: customerAccountIdSchema.make(accountId),
                  dotyposCustomerId: dotyposCustomerId as never,
                }),
              } as never)
            )
          )
        )
      );

    const seedLinkedInvoice = async () => {
      await testDatabase!.pool.query(
        `insert into invoices (id, workspace_reservation_id, payment_attempt_id,
           dotypos_customer_id, invoice_number, numbering_year, numbering_sequence,
           key_id, encrypted_document, issued_at)
         values ($1, null, null, $2, $3, 2026, 42, $4,
           pgp_sym_encrypt($5, $6), $7::timestamptz)`,
        [
          invoiceId,
          dotyposCustomerId,
          document.invoiceNumber,
          keyId,
          JSON.stringify(document),
          keySecret,
          issuedAt,
        ]
      );
    };

    const readStoredInvoiceCiphertext = async () => {
      const rows = await testDatabase!.pool.query(
        `select encode(encrypted_document, 'hex') as ciphertext
         from invoices where id = $1`,
        [invoiceId]
      );
      return rows.rows[0]?.ciphertext as string | undefined;
    };

    /**
     * Removes exactly the seeded fixture invoice row. The migrations make
     * issued invoices immutable (`invoices_immutable` rejects DELETE with
     * SQLSTATE 55000), so the disposable test database's trigger is
     * temporarily disabled inside one transaction — the same synthetic
     * fixture cleanup pattern the e2e invoice fixture uses — and always
     * re-enabled, even when the delete fails.
     */
    const cleanupSeededInvoice = async () => {
      const client = await testDatabase!.pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `alter table invoices disable trigger invoices_immutable`
        );
        const removed = await client.query(
          `delete from invoices where id = $1 returning id`,
          [invoiceId]
        );
        await client.query(
          `alter table invoices enable trigger invoices_immutable`
        );
        await client.query("commit");
        if (removed.rows.length !== 1) {
          throw new Error(
            `Fixture invoice cleanup expected to remove exactly one row, removed ${removed.rows.length}`
          );
        }
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    };

    test("keeps the issued invoice row while the customer account access ends", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `f-${account}@deskohub.test`);
      await linkRow(account, dotyposCustomerId);
      await seedLinkedInvoice();

      try {
        const ciphertextBefore = await readStoredInvoiceCiphertext();

        // While the account is linked, the owner-scoped ledger lists the
        // invoice and the row is retrievable under the owner filter.
        const linked = await Effect.runPromise(
          Effect.gen(function* () {
            const invoices = yield* InvoiceRepository;
            const summaries = yield* invoices.listForCustomer(
              dotyposCustomerId as never
            );
            const invoice = yield* invoices.findForCustomer(
              dotyposCustomerId as never,
              invoiceId
            );
            return { summaries, invoice };
          }).pipe(Effect.provide(makeInvoiceRepositoryLayer()))
        );
        expect(linked.summaries.map((summary) => summary.id)).toEqual([
          invoiceId,
        ]);
        expect(linked.invoice?.dotyposCustomerId).toBe(dotyposCustomerId);

        // The real service identity resolves this account, so while the
        // account is linked the service authorizes and serves the invoice.
        const authorized = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* CustomerInvoiceService;
            const pdf = yield* service.findPdf(invoiceId);
            const list = yield* service.list;
            return { list, pdf };
          }).pipe(Effect.provide(makeInvoiceServiceLayer(account)))
        );
        expect(authorized.list.map((summary) => summary.id)).toEqual([
          invoiceId,
        ]);
        expect(authorized.pdf.fileName).toBe(`${document.invoiceNumber}.pdf`);

        // The actual Better Auth identity deletion cascades the link away.
        await testDatabase!.pool.query(
          `delete from auth."user" where id = $1`,
          [account]
        );

        // The issued invoice row and its ciphertext survive unchanged.
        expect(await readStoredInvoiceCiphertext()).toBe(ciphertextBefore);

        // The link is gone, so the account activity state — the same guard
        // the customer invoice service authorizes on every call — reports
        // missing.
        const activity = await Effect.runPromise(
          Effect.gen(function* () {
            const links = yield* CustomerAccountLinkRepository;
            return yield* links.findActivityState(account);
          }).pipe(Effect.provide(layer))
        );
        expect(activity).toEqual({ kind: "missing" });

        // With the real auth user deleted, the service's activity guard
        // fails closed before any invoice storage is consulted, so the same
        // listing and PDF download that succeeded above are now denied even
        // though the invoice row survives.
        const denial = await Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* CustomerInvoiceService;
            return {
              list: yield* Effect.result(service.list),
              pdf: yield* Effect.result(service.findPdf(invoiceId)),
            };
          }).pipe(Effect.provide(makeInvoiceServiceLayer(account)))
        );
        expect(denial.list._tag).toBe("Failure");
        if (denial.list._tag === "Failure") {
          expect(denial.list.failure._tag).toBe(
            "CustomerInvoicesUnavailableError"
          );
        }
        expect(denial.pdf._tag).toBe("Failure");
        if (denial.pdf._tag === "Failure") {
          expect(denial.pdf.failure._tag).toBe(
            "CustomerInvoicesUnavailableError"
          );
        }
      } finally {
        await cleanupSeededInvoice();
      }
    });
  }
);

function uniqueDotyposId() {
  return `${Math.floor(Math.random() * 900000) + 100000}${Math.floor(
    Math.random() * 900
  )}`;
}

async function linkRow(accountId: string, dotyposCustomerId: string) {
  await testDatabase!.pool.query(
    `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
    [accountId, dotyposCustomerId]
  );
}
