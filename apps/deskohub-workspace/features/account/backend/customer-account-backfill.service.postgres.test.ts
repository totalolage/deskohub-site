import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import type { CapturedMagicLink } from "@/features/account/backend/auth/auth-handler.test-utils";
import type { CustomerAccountBackfillReport } from "@/features/account/backend/customer-account-backfill.service";

await import("@/shared/testing/workspace-test-env");
const [
  { DotyposCustomerIdSchema },
  { DotyposServiceMock },
  { testEmailAddress },
  { inArray },
  { Effect, Layer },
  { WorkspaceDatabaseAdvisoryLock },
  { customerAccounts, workspaceReservations },
  { makeTestAuth },
  { UnverifiedLogins },
  { CustomerAccountBackfill },
  { customerAccountIdSchema },
  { checkoutAttemptKeySchema },
  { workspaceReservationIdSchema },
  { connectWorkspacePostgresTestDatabase },
] = await Promise.all([
  import("@deskohub/dotypos"),
  import("@deskohub/dotypos/backend/service.mock"),
  import("@deskohub/test-email"),
  import("drizzle-orm"),
  import("effect"),
  import("@/db/postgres-advisory-lock"),
  import("@/db/schema"),
  import("@/features/account/backend/auth/auth-handler.test-utils"),
  import("@/features/account/backend/auth/unverified-logins.service"),
  import("@/features/account/backend/customer-account-backfill.service"),
  import("@/features/account/customer-account"),
  import("@/features/checkout/checkout-identifiers"),
  import("@/features/reservation/persistence-contracts"),
  import("@/shared/testing/workspace-postgres-test-database.test-utils"),
]);

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "CustomerAccountBackfill on disposable Postgres",
  () => {
    if (!testDatabase) return;

    type Fixture = {
      readonly prefix: string;
      readonly customerIds: DotyposCustomerId[];
      readonly accountIds: string[];
      readonly reservationIds: string[];
      readonly customers: Map<DotyposCustomerId, DotyposCustomer>;
    };

    const fixtures = new Set<Fixture>();
    const makeFixture = (): Fixture => {
      const fixture: Fixture = {
        prefix: `account-backfill-${crypto.randomUUID()}`,
        customerIds: [],
        accountIds: [],
        reservationIds: [],
        customers: new Map(),
      };
      fixtures.add(fixture);
      return fixture;
    };

    afterEach(async () => {
      for (const fixture of fixtures) {
        const users = await testDatabase.pool.query<{ id: string }>(
          `select id from auth."user" where email like $1`,
          [`${fixture.prefix}%`]
        );
        const userIds = users.rows.map(({ id }) => id);
        await testDatabase.pool.query(
          `delete from workspace_reservations where dotypos_customer_id = any($1::text[])`,
          [fixture.customerIds]
        );
        await testDatabase.pool.query(
          `delete from auth."user" where id = any($1::text[])`,
          [userIds]
        );
        await testDatabase.pool.query(
          `delete from customer_accounts
           where id = any($1::text[]) or dotypos_customer_id = any($2::text[])`,
          [
            [...new Set([...fixture.accountIds, ...userIds])],
            fixture.customerIds,
          ]
        );
      }
      fixtures.clear();
    });

    afterAll(async () => testDatabase.close());

    const makeCustomer = (
      id: DotyposCustomerId,
      overrides: Partial<DotyposCustomer> = {}
    ): DotyposCustomer =>
      ({
        id,
        _cloudId: "synthetic-cloud",
        firstName: "Synthetic",
        lastName: null,
        email: null,
        phone: null,
        points: "0",
        flags: "0",
        display: true,
        deleted: false,
        expireDate: null,
        ...overrides,
      }) as DotyposCustomer;

    const makeCustomerId = (fixture: Fixture, label: string) => {
      const id = DotyposCustomerIdSchema.make(`${fixture.prefix}-${label}`);
      fixture.customerIds.push(id);
      return id;
    };

    const makeEmail = (fixture: Fixture, label: string) =>
      testEmailAddress(`${fixture.prefix}-${label}`);

    const addCustomer = (
      fixture: Fixture,
      id: DotyposCustomerId,
      overrides: Partial<DotyposCustomer> = {}
    ) => fixture.customers.set(id, makeCustomer(id, overrides));

    const insertAuthUser = async (
      fixture: Fixture,
      email: string,
      emailVerified = false
    ) => {
      const id = customerAccountIdSchema.make(crypto.randomUUID());
      fixture.accountIds.push(id);
      await testDatabase.pool.query(
        `insert into auth."user" (id, name, email, email_verified)
         values ($1, '', $2, $3)`,
        [id, email, emailVerified]
      );
      return id;
    };

    const insertCustomerAccount = async (
      fixture: Fixture,
      input: {
        readonly id?: string;
        readonly customerId?: DotyposCustomerId | null;
        readonly deletedAt?: Date | null;
        readonly createdAt?: Date;
      } = {}
    ) => {
      const id = input.id ?? customerAccountIdSchema.make(crypto.randomUUID());
      if (!fixture.accountIds.includes(id)) fixture.accountIds.push(id);
      await testDatabase.pool.query(
        `insert into customer_accounts
          (id, dotypos_customer_id, deleted_at, created_at)
         values ($1, $2, $3, coalesce($4, now()))`,
        [
          id,
          input.customerId ?? null,
          input.deletedAt ?? null,
          input.createdAt ?? null,
        ]
      );
      return id;
    };

    const insertLink = async (
      accountId: string,
      customerId: DotyposCustomerId
    ) => {
      await testDatabase.pool.query(
        `insert into customer_account_links
          (customer_account_id, dotypos_customer_id) values ($1, $2)`,
        [accountId, customerId]
      );
    };

    const insertReservation = async (
      fixture: Fixture,
      input: {
        readonly customerId: DotyposCustomerId;
        readonly label: string;
        readonly locale?: "cs-CZ" | "en-US";
        readonly authorAccountId?: string | null;
        readonly createdAt?: string;
        readonly updatedAt?: string;
      }
    ) => {
      const id = workspaceReservationIdSchema.make(crypto.randomUUID());
      fixture.reservationIds.push(id);
      const createdAt = Temporal.Instant.from(
        input.createdAt ?? "2026-01-01T00:00:00Z"
      );
      const updatedAt = Temporal.Instant.from(
        input.updatedAt ?? "2025-01-01T00:00:00Z"
      );
      await Effect.runPromise(
        testDatabase.db.insert(workspaceReservations).values({
          id,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `${fixture.prefix}-${input.label}-${id}`
          ),
          dotyposCustomerId: input.customerId,
          authorAccountId: input.authorAccountId ?? null,
          reservationState: "hold_expired",
          paymentState: "not_started",
          fulfillmentState: "not_started",
          reservationDetails: { kind: "meeting-room" },
          locale: input.locale ?? "en-US",
          createdAt,
          updatedAt,
        })
      );
      return id;
    };

    const makeLayer = (fixture: Fixture, auth = makeTestAuth()) =>
      CustomerAccountBackfill.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            testDatabase.layer,
            WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase.pool),
            DotyposServiceMock({
              getCustomers: ({ ids }) =>
                Effect.succeed(
                  ids.flatMap((id) => {
                    const customer = fixture.customers.get(id);
                    return customer ? [customer] : [];
                  })
                ),
            }),
            UnverifiedLogins.makeLayer(auth)
          )
        )
      );

    const runBackfill = (
      fixture: Fixture,
      dryRun: boolean,
      auth = makeTestAuth()
    ) =>
      Effect.runPromise(
        CustomerAccountBackfill.pipe(
          Effect.flatMap((backfill) => backfill.run({ dryRun })),
          Effect.provide(makeLayer(fixture, auth))
        )
      );

    const expectRefusal = (
      report: CustomerAccountBackfillReport,
      dotyposCustomerId: DotyposCustomerId,
      reason: string,
      reservations: number
    ) =>
      expect(report.authors.refused).toContainEqual({
        dotyposCustomerId,
        reason,
        reservations,
      });

    const expectAuthorless = async (reservationIds: readonly string[]) => {
      const result = await testDatabase.pool.query<{
        id: string;
        author_account_id: string | null;
      }>(
        `select id, author_account_id from workspace_reservations
         where id = any($1::text[]) order by id`,
        [reservationIds]
      );
      expect(result.rows).toHaveLength(reservationIds.length);
      expect(
        result.rows.every(({ author_account_id }) => author_account_id === null)
      ).toBe(true);
    };

    test("creates missing login accounts only when applied", async () => {
      const fixture = makeFixture();
      const email = makeEmail(fixture, "eager-login");
      const accountId = await insertAuthUser(fixture, email);

      const dryRun = await runBackfill(fixture, true);
      expect(dryRun.logins).toEqual({ created: 1, alreadyPresent: 0 });
      const accountsAfterDryRun = await Effect.runPromise(
        testDatabase.db
          .select({ id: customerAccounts.id })
          .from(customerAccounts)
          .where(inArray(customerAccounts.id, [accountId]))
      );
      expect(accountsAfterDryRun).toEqual([]);

      const applied = await runBackfill(fixture, false);
      expect(applied.logins).toEqual({ created: 1, alreadyPresent: 0 });
      const accountsAfterApply = await Effect.runPromise(
        testDatabase.db
          .select({ id: customerAccounts.id })
          .from(customerAccounts)
          .where(inArray(customerAccounts.id, [accountId]))
      );
      expect(accountsAfterApply).toHaveLength(1);

      const nextDryRun = await runBackfill(fixture, true);
      expect(nextDryRun.logins).toEqual({ created: 0, alreadyPresent: 1 });
    });

    test("resyncs pending links and reports three unchanged link conflicts", async () => {
      const fixture = makeFixture();
      const pendingCustomer = makeCustomerId(fixture, "pending-link");
      const pendingAccount = await insertAuthUser(
        fixture,
        makeEmail(fixture, "pending-account")
      );
      await insertCustomerAccount(fixture, { id: pendingAccount });
      await insertLink(pendingAccount, pendingCustomer);

      const mismatchCustomer = makeCustomerId(fixture, "mismatch-link");
      const otherRecordedCustomer = makeCustomerId(fixture, "already-held");
      const mismatchAccount = await insertAuthUser(
        fixture,
        makeEmail(fixture, "mismatch-account")
      );
      await insertCustomerAccount(fixture, {
        id: mismatchAccount,
        customerId: otherRecordedCustomer,
      });
      await insertLink(mismatchAccount, mismatchCustomer);

      const heldCustomer = makeCustomerId(fixture, "held-by-another");
      const heldAccount = await insertAuthUser(
        fixture,
        makeEmail(fixture, "held-account")
      );
      await insertCustomerAccount(fixture, { id: heldAccount });
      await insertLink(heldAccount, heldCustomer);
      await insertCustomerAccount(fixture, { customerId: heldCustomer });

      const deletedCustomer = makeCustomerId(fixture, "deleted-account-link");
      const deletedAccount = await insertAuthUser(
        fixture,
        makeEmail(fixture, "deleted-account")
      );
      await insertCustomerAccount(fixture, {
        id: deletedAccount,
        deletedAt: new Date("2026-01-01T00:00:00Z"),
      });
      await insertLink(deletedAccount, deletedCustomer);

      const report = await runBackfill(fixture, false);
      expect(report.links).toMatchObject({ recorded: 1, conflicts: 3 });

      const accounts = await testDatabase.pool.query<{
        id: string;
        dotypos_customer_id: string | null;
      }>(
        `select id, dotypos_customer_id from customer_accounts
         where id = any($1::text[]) order by id`,
        [[pendingAccount, mismatchAccount, heldAccount, deletedAccount]]
      );
      const byId = new Map(accounts.rows.map((row) => [row.id, row]));
      expect(byId.get(pendingAccount)?.dotypos_customer_id).toBe(
        pendingCustomer
      );
      expect(byId.get(mismatchAccount)?.dotypos_customer_id).toBe(
        otherRecordedCustomer
      );
      expect(byId.get(heldAccount)?.dotypos_customer_id).toBeNull();
      expect(byId.get(deletedAccount)?.dotypos_customer_id).toBeNull();
    });

    test("tombstones settled orphan accounts and leaves recent ones alone", async () => {
      const fixture = makeFixture();
      const settledCustomer = makeCustomerId(fixture, "settled-orphan");
      const recentCustomer = makeCustomerId(fixture, "recent-orphan");
      const settledAccount = await insertCustomerAccount(fixture, {
        customerId: settledCustomer,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
      const recentAccount = await insertCustomerAccount(fixture, {
        customerId: recentCustomer,
      });

      const dryRun = await runBackfill(fixture, true);
      expect(dryRun.tombstones).toMatchObject({
        recorded: 1,
        alreadyDeleted: 0,
        skippedRecent: 1,
      });
      const afterDryRun = await testDatabase.pool.query(
        `select id, dotypos_customer_id, deleted_at from customer_accounts
         where id = any($1::text[]) order by id`,
        [[settledAccount, recentAccount]]
      );
      expect(afterDryRun.rows.every((row) => row.deleted_at === null)).toBe(
        true
      );

      const applied = await runBackfill(fixture, false);
      expect(applied.tombstones).toMatchObject({
        recorded: 1,
        skippedRecent: 1,
      });
      const accounts = await testDatabase.pool.query<{
        id: string;
        dotypos_customer_id: string | null;
        deleted_at: Date | null;
      }>(
        `select id, dotypos_customer_id, deleted_at from customer_accounts
         where id = any($1::text[])`,
        [[settledAccount, recentAccount]]
      );
      const byId = new Map(accounts.rows.map((row) => [row.id, row]));
      expect(byId.get(settledAccount)?.deleted_at).not.toBeNull();
      expect(byId.get(settledAccount)?.dotypos_customer_id).toBeNull();
      expect(byId.get(recentAccount)?.deleted_at).toBeNull();
      expect(byId.get(recentAccount)?.dotypos_customer_id).toBe(recentCustomer);
    });

    test("authors only the linked customer's authorless reservations", async () => {
      const fixture = makeFixture();
      const customerId = makeCustomerId(fixture, "linked-author");
      const linkedAccount = await insertAuthUser(
        fixture,
        makeEmail(fixture, "linked-author")
      );
      await insertCustomerAccount(fixture, { id: linkedAccount });
      await insertLink(linkedAccount, customerId);
      const existingAuthor = await insertAuthUser(
        fixture,
        makeEmail(fixture, "existing-author")
      );
      await insertCustomerAccount(fixture, { id: existingAuthor });
      const updatedAt = "2025-02-03T04:05:06Z";
      const authorless = await insertReservation(fixture, {
        customerId,
        label: "linked-authorless",
        updatedAt,
      });
      const alreadyAuthored = await insertReservation(fixture, {
        customerId,
        label: "different-author",
        authorAccountId: existingAuthor,
        updatedAt,
      });

      const report = await runBackfill(fixture, false);
      expect(report.authors).toMatchObject({
        alreadyAuthored: 1,
        viaLink: { customers: 1, reservations: 1 },
      });
      const rows = await testDatabase.pool.query<{
        id: string;
        author_account_id: string | null;
        updated_at: string;
      }>(
        `select id, author_account_id, updated_at from workspace_reservations
         where id = any($1::text[])`,
        [[authorless, alreadyAuthored]]
      );
      const byId = new Map(rows.rows.map((row) => [row.id, row]));
      expect(byId.get(authorless)?.author_account_id).toBe(linkedAccount);
      expect(byId.get(alreadyAuthored)?.author_account_id).toBe(existingAuthor);
      expect(new Date(byId.get(authorless)!.updated_at).toISOString()).toBe(
        new Date(updatedAt).toISOString()
      );
      expect(
        new Date(byId.get(alreadyAuthored)!.updated_at).toISOString()
      ).toBe(new Date(updatedAt).toISOString());
    });

    test("creates a silent lowercased login with the latest reservation locale", async () => {
      const fixture = makeFixture();
      const customerId = makeCustomerId(fixture, "new-login");
      const email = testEmailAddress(`${fixture.prefix}-MiXeD`);
      addCustomer(fixture, customerId, { email });
      await insertReservation(fixture, {
        customerId,
        label: "old-locale",
        locale: "en-US",
        createdAt: "2026-01-01T00:00:00Z",
      });
      const latestReservation = await insertReservation(fixture, {
        customerId,
        label: "latest-locale",
        locale: "cs-CZ",
        createdAt: "2026-02-01T00:00:00Z",
      });
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });

      const report = await runBackfill(fixture, false, auth);
      const users = await testDatabase.pool.query<{
        id: string;
        email: string;
        email_verified: boolean;
        locale: string | null;
      }>(
        `select id, email, email_verified, locale from auth."user"
         where email = $1`,
        [email.toLowerCase()]
      );
      expect(users.rows).toHaveLength(1);
      const user = users.rows[0]!;
      expect(user.email).toBe(email.toLowerCase());
      expect(user.email_verified).toBe(false);
      expect(user.locale).toBe("cs-CZ");
      expect(sentLinks).toEqual([]);

      const account = await testDatabase.pool.query<{
        dotypos_customer_id: string;
      }>(`select dotypos_customer_id from customer_accounts where id = $1`, [
        user.id,
      ]);
      expect(account.rows).toEqual([{ dotypos_customer_id: customerId }]);
      const link = await testDatabase.pool.query<{
        dotypos_customer_id: string;
      }>(
        `select dotypos_customer_id from customer_account_links
         where customer_account_id = $1`,
        [user.id]
      );
      expect(link.rows).toEqual([{ dotypos_customer_id: customerId }]);
      const events = await testDatabase.pool.query(
        `select id from customer_events
         where kind = 'account-created' and customer_account_id = $1`,
        [user.id]
      );
      expect(events.rows).toEqual([]);
      const reservation = await testDatabase.pool.query<{
        author_account_id: string | null;
      }>(`select author_account_id from workspace_reservations where id = $1`, [
        latestReservation,
      ]);
      expect(reservation.rows[0]?.author_account_id).toBe(user.id);
      expect(report.authors.viaNewLogin).toEqual({
        customers: 1,
        reservations: 2,
      });
    });

    test("resumes an unverified unlinked login without creating another user", async () => {
      const fixture = makeFixture();
      const customerId = makeCustomerId(fixture, "resumed-login");
      const email = makeEmail(fixture, "resumed-login");
      addCustomer(fixture, customerId, { email });
      const existingLogin = await insertAuthUser(fixture, email);
      await insertReservation(fixture, {
        customerId,
        label: "resumed-login-reservation",
      });

      const report = await runBackfill(fixture, false);
      const users = await testDatabase.pool.query<{ id: string }>(
        `select id from auth."user" where email = $1`,
        [email]
      );
      expect(users.rows).toEqual([{ id: existingLogin }]);
      expect(report.authors.viaResumedLogin).toEqual({
        customers: 1,
        reservations: 1,
      });
      const link = await testDatabase.pool.query(
        `select dotypos_customer_id from customer_account_links
         where customer_account_id = $1`,
        [existingLogin]
      );
      expect(link.rows).toEqual([{ dotypos_customer_id: customerId }]);
    });

    test("refuses a customer missing from Dotypos", async () => {
      const fixture = makeFixture();
      const customerId = makeCustomerId(fixture, "missing-customer");
      const reservations = [
        await insertReservation(fixture, {
          customerId,
          label: "missing-customer-reservation",
        }),
      ];

      const report = await runBackfill(fixture, false);
      expectRefusal(report, customerId, "customer_not_found", 1);
      await expectAuthorless(reservations);
    });

    test("refuses a deleted Dotypos customer", async () => {
      const fixture = makeFixture();
      const customerId = makeCustomerId(fixture, "deleted-customer");
      addCustomer(fixture, customerId, {
        email: makeEmail(fixture, "deleted-customer"),
        deleted: true,
      });
      const reservations = [
        await insertReservation(fixture, {
          customerId,
          label: "deleted-customer-reservation",
        }),
      ];

      const report = await runBackfill(fixture, false);
      expectRefusal(report, customerId, "customer_deleted", 1);
      await expectAuthorless(reservations);
    });

    test("refuses an expired Dotypos customer", async () => {
      const fixture = makeFixture();
      const customerId = makeCustomerId(fixture, "expired-customer");
      addCustomer(fixture, customerId, {
        email: makeEmail(fixture, "expired-customer"),
        expireDate: "2020-01-01T00:00:00Z",
      });
      const reservations = [
        await insertReservation(fixture, {
          customerId,
          label: "expired-customer-reservation",
        }),
      ];

      const report = await runBackfill(fixture, false);
      expectRefusal(report, customerId, "customer_expired", 1);
      await expectAuthorless(reservations);
    });

    test("refuses a customer with no email", async () => {
      const fixture = makeFixture();
      const customerId = makeCustomerId(fixture, "missing-email");
      addCustomer(fixture, customerId);
      const reservations = [
        await insertReservation(fixture, {
          customerId,
          label: "missing-email-reservation",
        }),
      ];

      const report = await runBackfill(fixture, false);
      expectRefusal(report, customerId, "email_missing", 1);
      await expectAuthorless(reservations);
    });

    test("refuses a customer with an invalid email", async () => {
      const fixture = makeFixture();
      const customerId = makeCustomerId(fixture, "invalid-email");
      addCustomer(fixture, customerId, { email: "malformed-email" });
      const reservations = [
        await insertReservation(fixture, {
          customerId,
          label: "invalid-email-reservation",
        }),
      ];

      const report = await runBackfill(fixture, false);
      expectRefusal(report, customerId, "email_invalid", 1);
      await expectAuthorless(reservations);
    });

    test("refuses duplicate email identities across unlinked and linked customers", async () => {
      const fixture = makeFixture();
      const duplicateEmail = makeEmail(fixture, "DuPlicate");
      const firstCustomer = makeCustomerId(fixture, "duplicate-first");
      const secondCustomer = makeCustomerId(fixture, "duplicate-second");
      addCustomer(fixture, firstCustomer, {
        email: makeEmail(fixture, "duplicate"),
      });
      addCustomer(fixture, secondCustomer, { email: duplicateEmail });
      const linkedCustomer = makeCustomerId(fixture, "duplicate-linked");
      const linkedEmail = makeEmail(fixture, "linked-identity");
      addCustomer(fixture, linkedCustomer, { email: linkedEmail });
      const linkedAccount = await insertAuthUser(
        fixture,
        makeEmail(fixture, "linked-identity-account")
      );
      await insertLink(linkedAccount, linkedCustomer);
      const linkedCandidate = makeCustomerId(fixture, "duplicate-linked-email");
      addCustomer(fixture, linkedCandidate, {
        email: testEmailAddress(`${fixture.prefix}-Linked-Identity`),
      });

      const reservations = await Promise.all(
        [firstCustomer, secondCustomer, linkedCandidate].map((customerId, i) =>
          insertReservation(fixture, {
            customerId,
            label: `duplicate-email-${i}`,
          })
        )
      );
      const report = await runBackfill(fixture, false);
      expectRefusal(report, firstCustomer, "email_duplicated", 1);
      expectRefusal(report, secondCustomer, "email_duplicated", 1);
      expectRefusal(report, linkedCandidate, "email_duplicated", 1);
      await expectAuthorless(reservations);
    });

    test("refuses verified and already-linked login conflicts", async () => {
      const fixture = makeFixture();
      const verifiedCustomer = makeCustomerId(fixture, "verified-conflict");
      const verifiedEmail = makeEmail(fixture, "verified-conflict");
      addCustomer(fixture, verifiedCustomer, { email: verifiedEmail });
      await insertAuthUser(fixture, verifiedEmail, true);

      const linkedLoginCustomer = makeCustomerId(
        fixture,
        "linked-login-conflict"
      );
      const linkedLoginEmail = makeEmail(fixture, "linked-login-conflict");
      addCustomer(fixture, linkedLoginCustomer, { email: linkedLoginEmail });
      const linkedLogin = await insertAuthUser(fixture, linkedLoginEmail);
      const anotherCustomer = makeCustomerId(fixture, "other-login-link");
      await insertLink(linkedLogin, anotherCustomer);

      const reservations = await Promise.all(
        [verifiedCustomer, linkedLoginCustomer].map((customerId, i) =>
          insertReservation(fixture, {
            customerId,
            label: `login-conflict-${i}`,
          })
        )
      );
      const report = await runBackfill(fixture, false);
      expectRefusal(report, verifiedCustomer, "login_conflict", 1);
      expectRefusal(report, linkedLoginCustomer, "login_conflict", 1);
      await expectAuthorless(reservations);
    });

    test("refuses a link row that conflicts with another account's customer column", async () => {
      const fixture = makeFixture();
      const customerId = makeCustomerId(fixture, "conflicting-link");
      const linkedAccount = await insertAuthUser(
        fixture,
        makeEmail(fixture, "conflicting-link-account")
      );
      await insertCustomerAccount(fixture, { id: linkedAccount });
      await insertLink(linkedAccount, customerId);
      await insertCustomerAccount(fixture, { customerId });
      const reservations = [
        await insertReservation(fixture, {
          customerId,
          label: "conflicting-link-reservation",
        }),
      ];

      const report = await runBackfill(fixture, false);
      expectRefusal(report, customerId, "link_conflict", 1);
      expect(report.links.conflicts).toBe(1);
      await expectAuthorless(reservations);
    });

    test("dry runs leave auth, account, link, and reservation author rows unchanged and predict apply", async () => {
      const fixture = makeFixture();
      const pendingLinkCustomer = makeCustomerId(fixture, "dry-link");
      const pendingLinkAccount = await insertAuthUser(
        fixture,
        makeEmail(fixture, "dry-link-account")
      );
      await insertLink(pendingLinkAccount, pendingLinkCustomer);

      const orphanCustomer = makeCustomerId(fixture, "dry-orphan");
      await insertCustomerAccount(fixture, {
        customerId: orphanCustomer,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });

      const newLoginCustomer = makeCustomerId(fixture, "dry-new-login");
      addCustomer(fixture, newLoginCustomer, {
        email: makeEmail(fixture, "dry-new-login"),
      });
      await insertReservation(fixture, {
        customerId: newLoginCustomer,
        label: "dry-new-login-reservation",
      });

      const snapshot = async () => {
        const [users, accounts, links, reservations] = await Promise.all([
          testDatabase.pool.query(`select * from auth."user" order by id`),
          testDatabase.pool.query(
            `select * from customer_accounts order by id`
          ),
          testDatabase.pool.query(
            `select * from customer_account_links order by customer_account_id`
          ),
          testDatabase.pool.query(
            `select id, author_account_id, updated_at from workspace_reservations order by id`
          ),
        ]);
        return {
          users: users.rows,
          accounts: accounts.rows,
          links: links.rows,
          reservations: reservations.rows,
        };
      };
      const before = await snapshot();
      const dryRun = await runBackfill(fixture, true);
      expect(await snapshot()).toEqual(before);

      const applied = await runBackfill(fixture, false);
      expect({ ...dryRun, dryRun: false }).toEqual(applied);
    });

    test("reruns idempotently and preserves the same refusal entries", async () => {
      const fixture = makeFixture();
      const linkedCustomer = makeCustomerId(fixture, "idempotent-linked");
      const linkedAccount = await insertAuthUser(
        fixture,
        makeEmail(fixture, "idempotent-linked-account")
      );
      await insertCustomerAccount(fixture, {
        id: linkedAccount,
        customerId: linkedCustomer,
      });
      await insertLink(linkedAccount, linkedCustomer);
      await insertReservation(fixture, {
        customerId: linkedCustomer,
        label: "idempotent-linked-reservation",
      });

      const newLoginCustomer = makeCustomerId(fixture, "idempotent-new-login");
      addCustomer(fixture, newLoginCustomer, {
        email: makeEmail(fixture, "idempotent-new-login"),
      });
      await insertReservation(fixture, {
        customerId: newLoginCustomer,
        label: "idempotent-new-login-reservation",
      });

      const refusedCustomer = makeCustomerId(fixture, "idempotent-refused");
      addCustomer(fixture, refusedCustomer, {
        email: makeEmail(fixture, "idempotent-refused"),
        deleted: true,
      });
      await insertReservation(fixture, {
        customerId: refusedCustomer,
        label: "idempotent-refused-reservation",
      });

      const firstApply = await runBackfill(fixture, false);
      const rerun = await runBackfill(fixture, true);
      expect(rerun.logins.created).toBe(0);
      expect(rerun.links.recorded).toBe(0);
      expect(rerun.tombstones.recorded).toBe(0);
      expect(rerun.authors.viaLink).toEqual({ customers: 0, reservations: 0 });
      expect(rerun.authors.viaNewLogin).toEqual({
        customers: 0,
        reservations: 0,
      });
      expect(rerun.authors.viaResumedLogin).toEqual({
        customers: 0,
        reservations: 0,
      });
      expect(rerun.authors.remainingCustomers).toBe(0);
      expect(rerun.authors.refused).toEqual(firstApply.authors.refused);
      expectRefusal(rerun, refusedCustomer, "customer_deleted", 1);
    });

    test("applies authors in batches of 100 linked customers", async () => {
      const fixture = makeFixture();
      const linkedCustomers = await Promise.all(
        Array.from({ length: 101 }, async (_, index) => {
          const customerId = makeCustomerId(fixture, `batch-${index}`);
          const accountId = await insertAuthUser(
            fixture,
            makeEmail(fixture, `batch-${index}`)
          );
          await insertCustomerAccount(fixture, { id: accountId });
          await insertLink(accountId, customerId);
          await insertReservation(fixture, {
            customerId,
            label: `batch-${index}`,
          });
          return customerId;
        })
      );

      const first = await runBackfill(fixture, false);
      expect(first.authors.viaLink).toEqual({
        customers: 100,
        reservations: 100,
      });
      expect(first.authors.remainingCustomers).toBe(1);

      const second = await runBackfill(fixture, false);
      expect(second.authors.viaLink).toEqual({
        customers: 1,
        reservations: 1,
      });
      expect(second.authors.remainingCustomers).toBe(0);
      expect(linkedCustomers).toHaveLength(101);
      const authored = await testDatabase.pool.query<{ count: number }>(
        `select count(*)::int as count from workspace_reservations
         where dotypos_customer_id = any($1::text[]) and author_account_id is not null`,
        [linkedCustomers]
      );
      expect(authored.rows[0]?.count).toBe(101);
    });
  }
);
