import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerSchema,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { customerAccounts } from "@/db/schema";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { manualInvoiceInputSchema } from "@/features/accounting/manual-invoice";
import { ReviewAccounts } from "@/features/review-accounts";
import { connectUnreachableWorkspaceDatabase } from "@/shared/testing/unreachable-workspace-database.test-utils";
import {
  syntheticDotyposCustomerId,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  createWorkspacePostgresSuiteDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";
import { CustomerAccountRepository } from "./customer-account.repository";
import { expireLinkedDotyposProfile } from "./customer-account-deletion";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAccountResolver } from "./customer-account-resolver.service";
import { CustomerAccountSections } from "./customer-account-sections";
import { CustomerAuthentication } from "./customer-authentication.service";
import { CustomerAvatarProviderError } from "./customer-avatar.service";
import {
  CustomerInvoiceService,
  CustomerInvoicesUnavailableError,
} from "./customer-invoice.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();
// Issued invoices are immutable, so the retention test issues its own into a
// database no other suite lists invoices from.
const invoiceDatabase = await createWorkspacePostgresSuiteDatabase(
  "account_deletion_invoices"
);
afterAll(() => invoiceDatabase?.close());

const uniqueId = () => crypto.randomUUID();

/** The adapter's success: the reread customer shows the expiration. */
const expireCustomer = (customerId: DotyposCustomerId) =>
  Effect.succeed(
    Option.some(
      Schema.decodeSync(DotyposCustomerSchema)({
        id: customerId,
        _cloudId: "cloud",
        firstName: "Smazaná",
        lastName: "Zákaznice",
        points: "0",
        flags: "0",
        display: true,
        deleted: true,
      })
    )
  );

const insertAuthUser = (id: CustomerAccountId, email: string) =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).account("deletion", {
      id,
      email,
      verified: false,
    })
  );

const insertLink = async (account: string, dotyposCustomerId: string) => {
  await testDatabase!.pool.query(
    `update customer_accounts set dotypos_customer_id = $2 where id = $1`,
    [account, dotyposCustomerId]
  );
};

/** The tombstone's deletion instant, null while active, undefined when absent. */
const readDeletedAt = async (account: CustomerAccountId) => {
  const [row] = await testDatabase!.db
    .select({ deletedAt: customerAccounts.deletedAt })
    .from(customerAccounts)
    .where(eq(customerAccounts.id, account))
    .pipe(Effect.runPromise);
  return row === undefined ? undefined : (row.deletedAt?.toString() ?? null);
};

/** Deletion rechecks only that the account exists, so it reads no session. */
const unreadSession = Layer.succeed(CustomerAuthentication, {
  currentUser: Effect.die("account deletion reads no session"),
});

/**
 * The repositories and the account sections on the disposable database. The
 * sections take the account lock through `sectionLock`, the real advisory
 * lock unless a test makes it unreachable.
 */
const makeRepositoryLayer = (
  sectionLock = WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool)
) => {
  const repositories = Layer.mergeAll(
    CustomerAccountLinkRepository.Default,
    CustomerAccountRepository.Default,
    ReviewAccounts.Default
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          WorkspaceDatabase,
          WorkspaceDatabase.make(testDatabase!.db)
        ),
        WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool)
      )
    )
  );
  return Layer.mergeAll(
    repositories,
    CustomerAccountSections.Default.pipe(
      Layer.provide(Layer.mergeAll(repositories, sectionLock, unreadSession))
    )
  );
};

describe.skipIf(!testDatabase)(
  "Customer account deletion on disposable Postgres",
  () => {
    test("marks, expires, and destroys the avatar under the real account advisory lock", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = syntheticDotyposCustomerId("deletion");
      await insertAuthUser(account, testEmailAddress(`del-${account}`));
      await insertLink(account, dotyposCustomerId);

      const order: string[] = [];

      await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const accounts = yield* CustomerAccountRepository;
          const reviewAccounts = yield* ReviewAccounts;
          const sections = yield* CustomerAccountSections;
          const requestDeletion = expireLinkedDotyposProfile({
            isReviewAccount: reviewAccounts.isReviewAccount,
            markDeletionRequested: links.markDeletionRequested,
            findLink: links.find,
            expireCustomer: (customerId) => {
              order.push(`expire:${customerId}`);
              return expireCustomer(customerId);
            },
            destroyAvatar: (destroyAccountId) => {
              order.push(`destroy-avatar:${destroyAccountId}`);
              return Effect.void;
            },
            tombstone: accounts.tombstone,
            withActiveAccount: sections.withActiveAccount,
            anonymiseAnalyticsPerson: () => Effect.void,
          });
          return yield* requestDeletion(account);
        }).pipe(Effect.provide(layer))
      );

      expect(order).toEqual([
        `expire:${dotyposCustomerId}`,
        `destroy-avatar:${account}`,
      ]);

      const marker = await testDatabase!.pool.query(
        `select deletion_requested_at from auth."user" where id = $1`,
        [account]
      );
      expect(marker.rows[0]?.deletion_requested_at).not.toBeNull();
      expect(await readDeletedAt(account)).not.toBeNull();
    });

    test("refuses to delete a review account and leaves its login and account untouched", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await Effect.runPromise(
        workspaceFixtures(testDatabase!.db).account("del-review", {
          id: account,
          verified: false,
          review: true,
        })
      );
      const providerCalls: string[] = [];

      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const accounts = yield* CustomerAccountRepository;
          const reviewAccounts = yield* ReviewAccounts;
          const sections = yield* CustomerAccountSections;
          return yield* expireLinkedDotyposProfile({
            isReviewAccount: reviewAccounts.isReviewAccount,
            markDeletionRequested: links.markDeletionRequested,
            findLink: links.find,
            expireCustomer: (customerId) => {
              providerCalls.push("expire");
              return expireCustomer(customerId);
            },
            destroyAvatar: () => {
              providerCalls.push("destroy-avatar");
              return Effect.void;
            },
            tombstone: accounts.tombstone,
            withActiveAccount: sections.withActiveAccount,
            anonymiseAnalyticsPerson: () => Effect.void,
          })(account).pipe(Effect.flip);
        }).pipe(Effect.provide(layer))
      );

      expect(outcome._tag).toBe("ReviewAccountDeletionRefusedError");
      expect(providerCalls).toEqual([]);
      const marker = await testDatabase!.pool.query(
        `select deletion_requested_at from auth."user" where id = $1`,
        [account]
      );
      expect(marker.rows).toEqual([{ deletion_requested_at: null }]);
      expect(await readDeletedAt(account)).toBeNull();
    });

    test("keeps the durable marker and Dotypos customer ID when avatar destroy fails retryably", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = syntheticDotyposCustomerId("deletion");
      await insertAuthUser(account, testEmailAddress(`del-${account}`));
      await insertLink(account, dotyposCustomerId);

      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const accounts = yield* CustomerAccountRepository;
          const reviewAccounts = yield* ReviewAccounts;
          const sections = yield* CustomerAccountSections;
          const requestDeletion = expireLinkedDotyposProfile({
            isReviewAccount: reviewAccounts.isReviewAccount,
            markDeletionRequested: links.markDeletionRequested,
            findLink: links.find,
            expireCustomer,
            destroyAvatar: () =>
              Effect.fail(new CustomerAvatarProviderError({})),
            tombstone: accounts.tombstone,
            withActiveAccount: sections.withActiveAccount,
            anonymiseAnalyticsPerson: () => Effect.void,
          });
          return yield* Effect.result(requestDeletion(account));
        }).pipe(Effect.provide(layer))
      );

      expect(outcome._tag).toBe("Failure");

      const marker = await testDatabase!.pool.query(
        `select deletion_requested_at from auth."user" where id = $1`,
        [account]
      );
      expect(marker.rows[0]?.deletion_requested_at).not.toBeNull();

      const link = await testDatabase!.pool.query(
        `select dotypos_customer_id from customer_accounts where id = $1`,
        [account]
      );
      expect(link.rows).toHaveLength(1);
      expect(link.rows[0]?.dotypos_customer_id).toBe(dotyposCustomerId);
      expect(await readDeletedAt(account)).toBeNull();

      // The retry finds the marker already set and completes the deletion.
      await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const accounts = yield* CustomerAccountRepository;
          const reviewAccounts = yield* ReviewAccounts;
          const sections = yield* CustomerAccountSections;
          return yield* expireLinkedDotyposProfile({
            isReviewAccount: reviewAccounts.isReviewAccount,
            markDeletionRequested: links.markDeletionRequested,
            findLink: links.find,
            expireCustomer,
            destroyAvatar: () => Effect.void,
            tombstone: accounts.tombstone,
            withActiveAccount: sections.withActiveAccount,
            anonymiseAnalyticsPerson: () => Effect.void,
          })(account);
        }).pipe(Effect.provide(layer))
      );
      expect(await readDeletedAt(account)).not.toBeNull();
    });

    test("fails retryably as an unavailable account lock and marks nothing", async () => {
      const unreachable = await connectUnreachableWorkspaceDatabase();
      try {
        const layer = makeRepositoryLayer(unreachable.advisoryLock);
        const account = customerAccountIdSchema.make(uniqueId());
        await insertAuthUser(account, testEmailAddress(`del-${account}`));
        await insertLink(account, syntheticDotyposCustomerId("deletion"));
        const providerCalls: string[] = [];

        const failure = await Effect.runPromise(
          Effect.gen(function* () {
            const links = yield* CustomerAccountLinkRepository;
            const accounts = yield* CustomerAccountRepository;
            const reviewAccounts = yield* ReviewAccounts;
            const sections = yield* CustomerAccountSections;
            return yield* expireLinkedDotyposProfile({
              isReviewAccount: reviewAccounts.isReviewAccount,
              markDeletionRequested: links.markDeletionRequested,
              findLink: links.find,
              expireCustomer: (customerId) => {
                providerCalls.push("expire");
                return expireCustomer(customerId);
              },
              destroyAvatar: () => {
                providerCalls.push("destroy-avatar");
                return Effect.void;
              },
              tombstone: accounts.tombstone,
              withActiveAccount: sections.withActiveAccount,
              anonymiseAnalyticsPerson: () => Effect.void,
            })(account).pipe(Effect.flip);
          }).pipe(Effect.provide(layer))
        );

        expect(failure).toMatchObject({
          _tag: "CustomerAccountAccessError",
          reason: "unavailable",
          cause: { code: "account-link.lock" },
        });
        expect(providerCalls).toEqual([]);
        const marker = await testDatabase!.pool.query(
          `select deletion_requested_at from auth."user" where id = $1`,
          [account]
        );
        expect(marker.rows).toEqual([{ deletion_requested_at: null }]);
        expect(await readDeletedAt(account)).toBeNull();
      } finally {
        await unreachable.pool.end();
      }
    });

    test("keeps an authored reservation and its author tombstone after the identity is removed", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = syntheticDotyposCustomerId("deletion");
      await insertAuthUser(account, testEmailAddress(`del-${account}`));
      await insertLink(account, dotyposCustomerId);
      const { id: reservationId } = await Effect.runPromise(
        workspaceFixtures(testDatabase!.db).reservation({
          stage: { reservation: "draft" },
          customer: dotyposCustomerId,
          author: account,
        })
      );

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const links = yield* CustomerAccountLinkRepository;
            const accounts = yield* CustomerAccountRepository;
            const reviewAccounts = yield* ReviewAccounts;
            const sections = yield* CustomerAccountSections;
            return yield* expireLinkedDotyposProfile({
              isReviewAccount: reviewAccounts.isReviewAccount,
              markDeletionRequested: links.markDeletionRequested,
              findLink: links.find,
              expireCustomer,
              destroyAvatar: () => Effect.void,
              tombstone: accounts.tombstone,
              withActiveAccount: sections.withActiveAccount,
              anonymiseAnalyticsPerson: () => Effect.void,
            })(account);
          }).pipe(Effect.provide(layer))
        );
        const deletedAt = await readDeletedAt(account);
        // Better Auth removes the identity rows once the hook succeeds.
        await testDatabase!.pool.query(
          `delete from auth."user" where id = $1`,
          [account]
        );

        const kept = await testDatabase!.pool.query(
          `select author_account_id from workspace_reservations where id = $1`,
          [reservationId]
        );
        expect(kept.rows).toEqual([{ author_account_id: account }]);
        expect(deletedAt).not.toBeNull();
        expect(await readDeletedAt(account)).toEqual(deletedAt);
        const link = await testDatabase!.pool.query(
          `select dotypos_customer_id from customer_accounts where id = $1`,
          [account]
        );
        expect(link.rows).toEqual([{ dotypos_customer_id: null }]);
        await expect(
          testDatabase!.pool.query(
            `delete from customer_accounts where id = $1`,
            [account]
          )
        ).rejects.toMatchObject({ code: "23001" });
      } finally {
        await testDatabase!.pool.query(
          `delete from workspace_reservations where id = $1`,
          [reservationId]
        );
        await testDatabase!.pool.query(
          `delete from auth."user" where id = $1`,
          [account]
        );
        await testDatabase!.pool.query(
          `delete from customer_accounts where id = $1`,
          [account]
        );
      }
    });

    test("a repeated deletion keeps the first tombstone instant", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = syntheticDotyposCustomerId("deletion");
      await Effect.runPromise(
        workspaceFixtures(testDatabase!.db).customerAccount({
          id: account,
          linkedCustomer: dotyposCustomerId,
        })
      );

      const tombstoneAt = (deletedAt: string) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const accounts = yield* CustomerAccountRepository;
            yield* accounts.tombstone(
              account,
              Temporal.Instant.from(deletedAt)
            );
          }).pipe(Effect.provide(layer))
        );

      await tombstoneAt("2026-10-17T10:00:00Z");
      await tombstoneAt("2026-10-17T11:00:00Z");

      expect(await readDeletedAt(account)).toBe("2026-10-17T10:00:00Z");
      const row = await testDatabase!.pool.query<{
        dotypos_customer_id: string | null;
      }>("select dotypos_customer_id from customer_accounts where id = $1", [
        account,
      ]);
      expect(row.rows[0]?.dotypos_customer_id).toBeNull();
    });
  }
);

describe.skipIf(!invoiceDatabase)(
  "Issued invoices after customer account deletion on disposable Postgres",
  () => {
    const accountingKey = {
      id: accountingSnapshotKeyIdSchema.make("K202611"),
      secret: "synthetic account deletion invoice secret!",
    };

    const makeLayer = () => {
      const storage = Layer.mergeAll(
        invoiceDatabase!.layer,
        WorkspaceDatabaseAdvisoryLock.makeLayer(invoiceDatabase!.pool),
        Layer.succeed(
          AccountingSnapshotKeyService,
          AccountingSnapshotKeyService.of({
            getActive: Effect.succeed(accountingKey),
            getById: () => Effect.succeed(accountingKey),
          })
        )
      );
      const repositories = Layer.mergeAll(
        CustomerAccountLinkRepository.Default,
        CustomerAccountRepository.Default,
        ReviewAccounts.Default,
        InvoiceRepository.Default.pipe(
          Layer.provide(AccountingDocumentSnapshotRepository.Default)
        )
      ).pipe(Layer.provideMerge(storage));
      return Layer.mergeAll(
        repositories,
        CustomerAccountSections.Default.pipe(
          Layer.provide(Layer.mergeAll(repositories, unreadSession))
        )
      );
    };

    test("keeps the customer's issued invoice and denies the deleted account access to it", async () => {
      const layer = makeLayer();
      const fixtures = workspaceFixtures(invoiceDatabase!.db);
      const dotyposCustomerId = syntheticDotyposCustomerId("deleted-invoices");
      const { accountId: account } = await Effect.runPromise(
        fixtures.account("deleted-invoices", {
          linkedCustomer: dotyposCustomerId,
        })
      );
      const issuer = await Effect.runPromise(
        fixtures.account("deleted-invoices-issuer")
      );
      const input = Schema.decodeUnknownSync(manualInvoiceInputSchema)({
        invoiceId: uniqueId(),
        dotyposCustomerId,
        buyer: {
          kind: "person",
          legalName: "Synthetic Deleted Customer",
          address: {
            line1: "Synthetic 1",
            city: "Praha",
            postalCode: "100 00",
            country: "CZ",
          },
        },
        deliveryEmail: testEmailAddress("deleted-invoices"),
        locale: "cs-CZ",
        serviceDate: "2026-10-01",
        payment: { status: "paid", date: "2026-10-01" },
        currency: "CZK",
        lines: [{ description: "Synthetic line", price: "100.00" }],
        provenance: { source: "admin-ui", actor: issuer.email },
      });

      const run = <A, E>(
        effect: Effect.Effect<A, E, Layer.Success<ReturnType<typeof makeLayer>>>
      ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

      const { invoice: issued } = await run(
        Effect.flatMap(InvoiceRepository, (invoices) =>
          invoices.issueManual({ ...input, issuedBy: issuer })
        )
      );

      await run(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const accounts = yield* CustomerAccountRepository;
          const reviewAccounts = yield* ReviewAccounts;
          const sections = yield* CustomerAccountSections;
          return yield* expireLinkedDotyposProfile({
            isReviewAccount: reviewAccounts.isReviewAccount,
            markDeletionRequested: links.markDeletionRequested,
            findLink: links.find,
            expireCustomer,
            destroyAvatar: () => Effect.void,
            tombstone: accounts.tombstone,
            withActiveAccount: sections.withActiveAccount,
            anonymiseAnalyticsPerson: () => Effect.void,
          })(account);
        })
      );
      // Better Auth removes the identity rows once the hook succeeds.
      await invoiceDatabase!.pool.query(
        `delete from auth."user" where id = $1`,
        [account]
      );

      const retained = await run(
        Effect.flatMap(InvoiceRepository, (invoices) =>
          Effect.all({
            byId: invoices.findById(issued.id),
            ofCustomer: invoices.listForCustomer(dotyposCustomerId),
          })
        )
      );
      expect(retained.byId?.id).toBe(issued.id);
      expect(retained.byId?.document).toEqual(issued.document);
      expect(retained.ofCustomer.map(({ id }) => id)).toEqual([issued.id]);

      // The tombstone cleared the account's customer, so no link leads to it.
      expect(
        await run(
          Effect.flatMap(CustomerAccountLinkRepository, (links) =>
            links.find(account)
          )
        )
      ).toBeNull();

      // Even a session resolved before the deletion is refused by the
      // account's activity, before any invoice is read.
      const staleResolution = Layer.mock(CustomerAccountResolver, {
        resolve: Effect.succeed({ accountId: account, dotyposCustomerId }),
      });
      const denied = await run(
        Effect.flatMap(CustomerInvoiceService, (invoices) =>
          Effect.all([
            Effect.flip(invoices.list),
            Effect.flip(invoices.pdf(issued.id)),
            Effect.flip(invoices.csv("cs-CZ")),
          ])
        ).pipe(
          Effect.provide(
            CustomerInvoiceService.Default.pipe(Layer.provide(staleResolution))
          )
        )
      );
      expect(denied).toEqual([
        new CustomerInvoicesUnavailableError(),
        new CustomerInvoicesUnavailableError(),
        new CustomerInvoicesUnavailableError(),
      ]);
    });
  }
);
