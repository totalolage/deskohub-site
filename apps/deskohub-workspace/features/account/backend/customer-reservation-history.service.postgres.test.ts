import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposCustomerSchema,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposReservationIdSchema,
  DotyposReservationSchema,
  DotyposService,
  ExternalAPIError,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { workspaceReservations } from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerReservationHistoryService } from "./customer-reservation-history.service";
import {
  ReservationAuthorDirectory,
  ReservationAuthorReadError,
} from "./reservation-author-directory.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID();
const uniqueDotyposId = () =>
  `${Math.floor(Math.random() * 900000) + 100000}${Math.floor(
    Math.random() * 900
  )}`;

const makeDotyposReservation = (
  overrides: Partial<DotyposReservation> = {}
): DotyposReservation =>
  Schema.decodeUnknownSync(DotyposReservationSchema)({
    _branchId: "branch",
    _cloudId: "cloud",
    startDate: "2000-01-01T10:00:00.000Z",
    endDate: "2000-01-01T11:00:00.000Z",
    seats: "2",
    status: "CONFIRMED",
    ...overrides,
  });

const makeDotyposCustomer = (
  id: DotyposCustomerId,
  firstName: string,
  lastName: string
): DotyposCustomer =>
  Schema.decodeUnknownSync(DotyposCustomerSchema)({
    id,
    _cloudId: "cloud",
    firstName,
    lastName,
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
  });

const insertAuthUser = async (id: string, email: string) => {
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, email]
  );
};

const insertCustomerAccount = async (input: {
  readonly id: CustomerAccountId;
  readonly deleted?: boolean;
  readonly dotyposCustomerId?: DotyposCustomerId;
}) => {
  await testDatabase!.pool.query(
    `insert into customer_accounts (id, deleted_at) values ($1, $2)`,
    [input.id, input.deleted ? new Date() : null]
  );
  if (input.deleted) return;
  await insertAuthUser(input.id, testEmailAddress(`h-${input.id}`));
  if (input.dotyposCustomerId) {
    await testDatabase!.pool.query(
      `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
      [input.id, input.dotyposCustomerId]
    );
  }
};

const insertWorkspaceReservation = async (input: {
  readonly id: WorkspaceReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly dotyposReservationId: DotyposReservationId;
  readonly authorAccountId?: CustomerAccountId;
}) => {
  await Effect.runPromise(
    testDatabase!.db.insert(workspaceReservations).values({
      id: input.id,
      checkoutAttemptKey: checkoutAttemptKeySchema.make(
        `attempt-${uniqueId()}`
      ),
      dotyposCustomerId: input.dotyposCustomerId,
      dotyposReservationId: input.dotyposReservationId,
      authorAccountId: input.authorAccountId ?? null,
      reservationState: "confirmed",
      paymentState: "not_started",
      fulfillmentState: "not_started",
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      locale: "en-US",
    })
  );
};

const testDatabaseLayer = () =>
  Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.of({ db: testDatabase!.db })
  );

/**
 * Stands in for Dotypos: a reservation without a customer belongs to every
 * customer query, and lists come back newest start first, as Dotypos sorts
 * them. Reads fail with the supplied failure, when there is one.
 */
const makeHistoryLayer = (
  reservations: readonly DotyposReservation[],
  options: {
    readonly customers?: readonly DotyposCustomer[];
    readonly customerReads?: DotyposCustomerId[][];
    readonly failNames?: boolean;
    readonly failAuthors?: boolean;
  } = {}
) =>
  CustomerReservationHistoryService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        testDatabaseLayer(),
        Layer.mock(DotyposService, {
          listReservations: (filter = {}) =>
            Effect.succeed(
              reservations
                .filter(
                  (reservation) =>
                    (!filter.customerId ||
                      !reservation._customerId ||
                      reservation._customerId === filter.customerId) &&
                    (!filter.ids ||
                      (reservation.id !== undefined &&
                        filter.ids.includes(reservation.id)))
                )
                .toSorted((a, b) =>
                  (b.startDate ?? "").localeCompare(a.startDate ?? "")
                )
            ),
          getCustomers: ({ ids }) => {
            options.customerReads?.push([...ids]);
            return options.failNames
              ? Effect.fail(
                  new ExternalAPIError({
                    service: "dotypos",
                    operation: "getCustomers",
                    statusCode: 503,
                  })
                )
              : Effect.succeed(
                  (options.customers ?? []).filter(
                    (customer) => customer.id && ids.includes(customer.id)
                  )
                );
          },
        } as Partial<DotyposService["Service"]>),
        options.failAuthors
          ? Layer.succeed(
              ReservationAuthorDirectory,
              ReservationAuthorDirectory.of({
                describe: () =>
                  Effect.fail(
                    new ReservationAuthorReadError({
                      code: "reservation-author.read",
                    })
                  ),
              })
            )
          : ReservationAuthorDirectory.Default.pipe(
              Layer.provide(testDatabaseLayer())
            ),
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
        )
      )
    )
  );

describe.skipIf(!testDatabase)(
  "CustomerReservationHistoryService on disposable Postgres",
  () => {
    test("blocks reservation history for a deletion marker or a removed account", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, testEmailAddress(`h-${account}`));
      await testDatabase!.pool.query(
        `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
        [account, dotyposCustomerId]
      );

      const layer = makeHistoryLayer([]);

      const runLoad = () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const history = yield* CustomerReservationHistoryService;
            return yield* history.load({
              accountId: account,
              dotyposCustomerId,
            });
          }).pipe(Effect.provide(layer), Effect.result)
        );

      const active = await runLoad();
      expect(active._tag).toBe("Success");

      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = now() where id = $1`,
        [account]
      );
      const marked = await runLoad();
      expect(marked._tag).toBe("Failure");
      if (marked._tag === "Failure") {
        const error = marked.failure as {
          reason?: string;
          linkReason?: string;
        };
        expect(error.reason).toBe("link-required");
        expect(error.linkReason).toBe("deletion-requested");
      }

      await testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
        account,
      ]);
      const removed = await runLoad();
      expect(removed._tag).toBe("Failure");
      if (removed._tag === "Failure") {
        const error = removed.failure as { reason?: string };
        expect(error.reason).toBe("unauthenticated");
      }
    });

    test("exposes a workspace ID only for an owner-matched local reservation", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = DotyposCustomerIdSchema.make(uniqueDotyposId());
      const foreignCustomerId = DotyposCustomerIdSchema.make(uniqueDotyposId());
      const matchedWorkspaceReservationId = workspaceReservationIdSchema.make(
        `workspace-${uniqueId()}`
      );
      const foreignWorkspaceReservationId = workspaceReservationIdSchema.make(
        `workspace-${uniqueId()}`
      );
      const matchedDotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-${uniqueId()}`
      );
      const providerOnlyDotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-${uniqueId()}`
      );
      const foreignDotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-${uniqueId()}`
      );

      await insertAuthUser(account, testEmailAddress(`h-${account}`));
      await testDatabase!.pool.query(
        `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
        [account, dotyposCustomerId]
      );
      await insertWorkspaceReservation({
        id: matchedWorkspaceReservationId,
        dotyposCustomerId,
        dotyposReservationId: matchedDotyposReservationId,
      });
      await insertWorkspaceReservation({
        id: foreignWorkspaceReservationId,
        dotyposCustomerId: foreignCustomerId,
        dotyposReservationId: foreignDotyposReservationId,
      });

      const history = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomerReservationHistoryService;
          return yield* service.load({ accountId: account, dotyposCustomerId });
        }).pipe(
          Effect.provide(
            makeHistoryLayer([
              makeDotyposReservation({
                id: matchedDotyposReservationId,
                startDate: "2000-01-01T10:00:00.000Z",
                endDate: "2000-01-01T11:00:00.000Z",
              }),
              makeDotyposReservation({
                id: providerOnlyDotyposReservationId,
                startDate: "2000-01-02T10:00:00.000Z",
                endDate: "2000-01-02T11:00:00.000Z",
              }),
              makeDotyposReservation({
                startDate: "2000-01-03T10:00:00.000Z",
                endDate: "2000-01-03T11:00:00.000Z",
              }),
              makeDotyposReservation({
                id: foreignDotyposReservationId,
                startDate: "2000-01-04T10:00:00.000Z",
                endDate: "2000-01-04T11:00:00.000Z",
              }),
            ])
          )
        )
      );

      expect(history.kind).toBe("available");
      if (history.kind !== "available") throw new Error("History unavailable");

      const summaries = history.groups.past;
      expect(summaries.map((summary) => summary.id)).toEqual([
        foreignDotyposReservationId,
        "2000-01-03T10:00:00.000Z:1",
        providerOnlyDotyposReservationId,
        matchedWorkspaceReservationId,
      ]);
      expect(summaries[3]).toMatchObject({
        workspaceReservationId: matchedWorkspaceReservationId,
      });
      for (const summary of summaries.slice(0, 3)) {
        expect("workspaceReservationId" in summary).toBe(false);
      }
      expect(summaries.some((summary) => "party" in summary)).toBe(false);
    });

    const seedParties = async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const otherAuthor = customerAccountIdSchema.make(uniqueId());
      const deletedAuthor = customerAccountIdSchema.make(uniqueId());
      const unrelatedAccount = customerAccountIdSchema.make(uniqueId());
      const customerId = DotyposCustomerIdSchema.make(uniqueDotyposId());
      const otherAuthorCustomerId = DotyposCustomerIdSchema.make(
        uniqueDotyposId()
      );
      const bookedForCustomerId = DotyposCustomerIdSchema.make(
        uniqueDotyposId()
      );
      const unrelatedCustomerId = DotyposCustomerIdSchema.make(
        uniqueDotyposId()
      );
      await insertCustomerAccount({
        id: account,
        dotyposCustomerId: customerId,
      });
      await insertCustomerAccount({
        id: otherAuthor,
        dotyposCustomerId: otherAuthorCustomerId,
      });
      await insertCustomerAccount({ id: deletedAuthor, deleted: true });
      await insertCustomerAccount({
        id: unrelatedAccount,
        dotyposCustomerId: unrelatedCustomerId,
      });

      const seeded = [
        { key: "own", customer: customerId, author: account },
        { key: "authorless", customer: customerId, author: undefined },
        { key: "booked-for", customer: bookedForCustomerId, author: account },
        { key: "booked-by", customer: customerId, author: otherAuthor },
        { key: "deleted-author", customer: customerId, author: deletedAuthor },
        {
          key: "unrelated",
          customer: unrelatedCustomerId,
          author: unrelatedAccount,
        },
      ] as const;
      const ids = new Map<
        (typeof seeded)[number]["key"],
        {
          readonly workspace: WorkspaceReservationId;
          readonly dotypos: DotyposReservationId;
        }
      >();
      const reservations: DotyposReservation[] = [];
      for (const [index, entry] of seeded.entries()) {
        const workspace = workspaceReservationIdSchema.make(
          `workspace-${uniqueId()}`
        );
        const dotypos = DotyposReservationIdSchema.make(
          `dotypos-${uniqueId()}`
        );
        ids.set(entry.key, { workspace, dotypos });
        await insertWorkspaceReservation({
          id: workspace,
          dotyposCustomerId: entry.customer,
          dotyposReservationId: dotypos,
          ...(entry.author && { authorAccountId: entry.author }),
        });
        reservations.push(
          makeDotyposReservation({
            id: dotypos,
            _customerId: entry.customer,
            startDate: `2000-02-0${index + 1}T10:00:00.000Z`,
            endDate: `2000-02-0${index + 1}T11:00:00.000Z`,
          })
        );
      }
      return {
        account: { accountId: account, dotyposCustomerId: customerId },
        ids: (key: (typeof seeded)[number]["key"]) => ids.get(key)!,
        reservations,
        customers: [
          makeDotyposCustomer(bookedForCustomerId, "Karla", "Ukázková"),
          makeDotyposCustomer(otherAuthorCustomerId, "Petr", "Testovací"),
          makeDotyposCustomer(unrelatedCustomerId, "Nikdo", "Cizí"),
        ],
        bookedForCustomerId,
        otherAuthorCustomerId,
      };
    };

    const loadPast = async (
      account: {
        accountId: CustomerAccountId;
        dotyposCustomerId: DotyposCustomerId;
      },
      layer: ReturnType<typeof makeHistoryLayer>
    ) => {
      const history = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomerReservationHistoryService;
          return yield* service.load(account);
        }).pipe(Effect.provide(layer))
      );
      if (history.kind !== "available") throw new Error("History unavailable");
      return history.groups.past;
    };

    test("labels reservations booked for another customer or by another account", async () => {
      const seeded = await seedParties();
      const customerReads: DotyposCustomerId[][] = [];
      const past = await loadPast(
        seeded.account,
        makeHistoryLayer(seeded.reservations, {
          customers: seeded.customers,
          customerReads,
        })
      );

      expect(
        past.map(({ id, workspaceReservationId, party }) => ({
          id,
          workspaceReservationId,
          party,
        }))
      ).toEqual([
        {
          id: seeded.ids("deleted-author").workspace,
          workspaceReservationId: seeded.ids("deleted-author").workspace,
          party: { kind: "booked-by-deleted-account" },
        },
        {
          id: seeded.ids("booked-by").workspace,
          workspaceReservationId: seeded.ids("booked-by").workspace,
          party: { kind: "booked-by", authorName: "Petr Testovací" },
        },
        {
          id: seeded.ids("booked-for").workspace,
          workspaceReservationId: seeded.ids("booked-for").workspace,
          party: { kind: "booked-for", customerName: "Karla Ukázková" },
        },
        {
          id: seeded.ids("authorless").workspace,
          workspaceReservationId: seeded.ids("authorless").workspace,
          party: undefined,
        },
        {
          id: seeded.ids("own").workspace,
          workspaceReservationId: seeded.ids("own").workspace,
          party: undefined,
        },
      ]);
      expect(
        past.some(({ id }) => id === seeded.ids("unrelated").workspace)
      ).toBe(false);
      expect(customerReads.map((ids) => ids.toSorted())).toEqual([
        [seeded.bookedForCustomerId, seeded.otherAuthorCustomerId].toSorted(),
      ]);
    });

    test("keeps the history and neutral labels when party lookups fail", async () => {
      const seeded = await seedParties();
      const past = await loadPast(
        seeded.account,
        makeHistoryLayer(seeded.reservations, {
          customers: seeded.customers,
          failNames: true,
          failAuthors: true,
        })
      );

      expect(past.map(({ party }) => party)).toEqual([
        { kind: "booked-by", authorName: null },
        { kind: "booked-by", authorName: null },
        { kind: "booked-for", customerName: null },
        undefined,
        undefined,
      ]);
    });

    test("names a deleted author neutrally even when customer names fail", async () => {
      const seeded = await seedParties();
      const past = await loadPast(
        seeded.account,
        makeHistoryLayer(seeded.reservations, {
          customers: seeded.customers,
          failNames: true,
        })
      );

      expect(past.map(({ party }) => party)).toEqual([
        { kind: "booked-by-deleted-account" },
        { kind: "booked-by", authorName: null },
        { kind: "booked-for", customerName: null },
        undefined,
        undefined,
      ]);
    });
  }
);
