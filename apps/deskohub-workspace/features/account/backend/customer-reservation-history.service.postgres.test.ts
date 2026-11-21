import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
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
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { loadAccountPasses } from "@/features/account/account-passes.server";
import { loadAccountUnlimitedPasses } from "@/features/account/account-unlimited-passes.server";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { ReservationRecords } from "@/features/reservation/backend/reservation-records";
import {
  type StoredWorkspaceReservationDetails,
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
import {
  fixtureReservationAuthorId,
  type ReservationFixtureStage,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { maskEmailAddress } from "@/shared/utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";
import { CurrentCustomerAccount } from "./current-customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerProfileService } from "./customer-profile.service";
import {
  CustomerReservationHistoryService,
  type ReservationHistoryAccount,
  type ReservationHistoryOptions,
} from "./customer-reservation-history.service";
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

const insertAuthUser = (id: CustomerAccountId, email: string) =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).account("history", {
      id,
      email,
      verified: false,
    })
  );

const insertCustomerAccount = async (input: {
  readonly id: CustomerAccountId;
  readonly deleted?: boolean;
  readonly dotyposCustomerId?: DotyposCustomerId;
}) => {
  const fixtures = workspaceFixtures(testDatabase!.db);
  if (input.deleted) {
    await Effect.runPromise(
      fixtures.customerAccount({
        id: input.id,
        deletedAt: Temporal.Now.instant(),
      })
    );
    return;
  }
  await Effect.runPromise(
    fixtures.account("history", {
      id: input.id,
      email: testEmailAddress(`h-${input.id}`),
      verified: false,
      linkedCustomer: input.dotyposCustomerId,
    })
  );
};

const insertWorkspaceReservation = async (input: {
  readonly id: WorkspaceReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly dotyposReservationId: DotyposReservationId;
  readonly authorAccountId: CustomerAccountId;
  readonly stage?: ReservationFixtureStage;
  readonly details?: StoredWorkspaceReservationDetails;
}) => {
  await Effect.runPromise(
    workspaceFixtures(testDatabase!.db).reservation({
      stage: input.stage ?? { reservation: "confirmed" },
      customer: input.dotyposCustomerId,
      author: input.authorAccountId,
      ...(input.details && { details: input.details }),
      overrides: {
        id: input.id,
        dotyposReservationId: input.dotyposReservationId,
      },
    })
  );
};

const testDatabaseLayer = () =>
  Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(testDatabase!.db));

/**
 * Stands in for Dotypos: a reservation without a customer belongs to every
 * customer query, and lists come back newest start first, as Dotypos sorts
 * them. Reads fail with the supplied failure, when there is one.
 */
/** Reads reservation records live, noting each customer list request. */
const recordingCustomerListReads = (
  reads:
    | Parameters<ReservationRecords["Service"]["listForCustomer"]>[0][]
    | undefined
) =>
  Layer.effect(
    ReservationRecords,
    Effect.gen(function* () {
      const live = yield* ReservationRecords;
      return {
        ...live,
        listForCustomer: (input) => {
          reads?.push(input);
          return live.listForCustomer(input);
        },
      } satisfies ReservationRecords["Service"];
    })
  ).pipe(Layer.provide(ReservationRecords.Provider));

const makeHistoryLayer = (
  reservations: readonly DotyposReservation[],
  options: {
    readonly customers?: readonly DotyposCustomer[];
    readonly customerReads?: DotyposCustomerId[][];
    readonly failNames?: boolean;
    readonly failAuthors?: boolean;
    readonly customerListReads?: Parameters<
      ReservationRecords["Service"]["listForCustomer"]
    >[0][];
  } = {}
) =>
  CustomerReservationHistoryService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        testDatabaseLayer(),
        ReviewAccounts.Default.pipe(Layer.provide(testDatabaseLayer())),
        ReviewSandbox.Default.pipe(Layer.provide(testDatabaseLayer())),
        recordingCustomerListReads(options.customerListReads).pipe(
          Layer.provideMerge(
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
              getReservationsByIds: (ids, readOptions) => {
                const filter = { ...readOptions, ids: [...ids] };
                return Effect.succeed(
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
                ).pipe(
                  Effect.flatMap((records) =>
                    makeInMemoryDotypos({
                      reservations: records,
                    }).service.getReservationsByIds(ids)
                  )
                );
              },
              getCustomersByIds: (ids) => {
                options.customerReads?.push([...ids]);
                return (
                  options.failNames
                    ? Effect.fail(
                        new DotyposUnavailable({
                          operation: "getCustomersByIds",
                          reason: "server",
                        })
                      )
                    : Effect.succeed(
                        (options.customers ?? []).filter(
                          (customer) => customer.id && ids.includes(customer.id)
                        )
                      )
                ).pipe(
                  Effect.flatMap((records) =>
                    makeInMemoryDotypos({
                      customers: records,
                    }).service.getCustomersByIds(ids)
                  )
                );
              },
            } as Partial<DotyposService["Service"]>)
          )
        ),
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
                WorkspaceDatabase.make(testDatabase!.db)
              ),
              WorkspaceDatabaseAdvisoryLock.makeLayer(
                testDatabase!.databasePool
              )
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
        `update customer_accounts set dotypos_customer_id = $2 where id = $1`,
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

    test("excludes Unlimited days from reservation history and shows the period to the claimed holder", async () => {
      const buyer = customerAccountIdSchema.make(uniqueId());
      const holder = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = DotyposCustomerIdSchema.make(uniqueDotyposId());
      const passId = uniqueId();
      const attachedDay = DotyposReservationIdSchema.make(uniqueId());
      const ordinary = DotyposReservationIdSchema.make(uniqueId());
      const pendingDay = DotyposReservationIdSchema.make(uniqueId());
      const replacedDay = DotyposReservationIdSchema.make(uniqueId());
      const parkedDay = DotyposReservationIdSchema.make(uniqueId());

      for (const accountId of [buyer, holder]) {
        await insertAuthUser(accountId, testEmailAddress(`h-${accountId}`));
      }
      await testDatabase!.pool.query(
        "update customer_accounts set dotypos_customer_id = $2 where id = $1",
        [holder, dotyposCustomerId]
      );
      await testDatabase!.pool.query(
        `insert into orders (id, kind, dotypos_customer_id, payment_state, fulfillment_state, paid_at)
         values ($1, 'pass-purchase', $2, 'paid', 'not_started', '2026-03-15T10:00:00Z')`,
        [passId, dotyposCustomerId]
      );
      await testDatabase!.pool.query(
        `insert into pass_purchases
           (id, buyer_account_id, holder_account_id, product, tier, unlimited_coffee,
            status, valid_from, valid_until, quote, locale, created_at)
         values ($1, $2, $3, 'unlimited', 'open-space', false,
            'active', '2026-03-16', '2026-04-15', '{}', 'en-US', now())`,
        [passId, buyer, holder]
      );
      await testDatabase!.pool.query(
        `insert into workspace_reservations
           (checkout_attempt_key, dotypos_customer_id, author_account_id,
            dotypos_reservation_id, reservation_state, payment_state, fulfillment_state, paid_at,
            reservation_details, locale, pass_id, service_date, pass_day_table_id)
         values (uuid_generate_v7(), $1, $2, $3, 'confirmed', 'paid', 'not_started',
            '2026-03-15T10:00:00Z', '{}', 'en-US', $4, '2026-03-16', '9')`,
        [dotyposCustomerId, buyer, attachedDay, passId]
      );
      await testDatabase!.pool.query(
        `insert into unlimited_pass_day_moves
           (generation, reservation_id, customer_id, source_reservation_id, source_table_id,
            target_reservation_id, target_table_id, requested_at, checked_at, attached_at, settled_at)
         select uuid_generate_v7(), id, $1, $2, '8', $3, '9', now(), now(), now(), now()
         from workspace_reservations where pass_id = $4`,
        [dotyposCustomerId, replacedDay, attachedDay, passId]
      );
      await testDatabase!.pool.query(
        `insert into unlimited_pass_day_moves
           (generation, reservation_id, customer_id, source_reservation_id, source_table_id,
            target_table_id, requested_at, checked_at, ambiguous_at, ambiguous_reservation_ids)
         select uuid_generate_v7(), id, $1, $2, '9', '10', now(), now(), now(), $3::text[]
         from workspace_reservations where pass_id = $4`,
        [dotyposCustomerId, attachedDay, [parkedDay, uniqueId()], passId]
      );
      const accountHistory = await Effect.runPromise(
        Effect.flatMap(CustomerReservationHistoryService, (service) =>
          service.load({ accountId: holder, dotyposCustomerId })
        ).pipe(
          Effect.provide(
            makeHistoryLayer([
              makeDotyposReservation({ id: ordinary }),
              makeDotyposReservation({ id: attachedDay }),
              makeDotyposReservation({
                id: pendingDay,
                status: "NEW",
                note: `Deskohub Unlimited ${passId}/2026-03-17`,
              }),
              makeDotyposReservation({
                id: replacedDay,
                status: "CANCELLED",
                note: "Synthetic staff note after the move",
              }),
              makeDotyposReservation({
                id: parkedDay,
                status: "CONFIRMED",
                note: "Synthetic staff note after parking the move",
              }),
            ])
          )
        )
      );

      expect(accountHistory.kind).toBe("available");
      if (accountHistory.kind !== "available")
        throw new Error("Missing history");
      expect(
        Object.values(accountHistory.groups)
          .flat()
          .map(({ id }) => id)
      ).toEqual([ordinary]);
      expect(JSON.stringify(accountHistory)).not.toContain(
        "Deskohub Unlimited"
      );

      const readPassViews = (accountId: CustomerAccountId, now: string) =>
        Effect.runPromise(
          Effect.andThen(
            TestClock.setTime(Temporal.Instant.from(now).epochMilliseconds),
            Effect.all({
              unlimited: loadAccountUnlimitedPasses("en-US"),
              packs: loadAccountPasses("en-US"),
            })
          ).pipe(
            Effect.provide(
              Layer.mergeAll(
                testDatabaseLayer(),
                Layer.mock(AdvisoryAvailabilityInventory, {}),
                Layer.mock(CurrentCustomerAccount, {
                  peek: Effect.succeed({
                    kind: "unlinked",
                    reviewMarker: "absent",
                    session: {
                      accountId,
                      email: reservationCustomerEmailSchema.make(
                        testEmailAddress(`session-${accountId}`)
                      ),
                      displayName: null,
                      deletionRequested: false,
                      accountCreatedAt: Temporal.Instant.from(now),
                      accountUpdatedAt: Temporal.Instant.from(now),
                    },
                  }),
                })
              )
            ),
            Effect.provide(TestClock.layer())
          )
        );
      const firstDay = "2026-03-15T23:00:00Z";
      const holderEmail = testEmailAddress(`h-${holder}`);
      const buyerView = await readPassViews(buyer, firstDay);
      expect(buyerView.unlimited).toEqual([]);
      expect(buyerView.packs).toMatchObject({
        held: [],
        boughtForOthers: [
          {
            orderId: passId,
            product: "unlimited",
            statusPath: `/en-US/reservation/status/${passId}`,
            maskedHolderEmail: maskEmailAddress(holderEmail),
            claimed: false,
          },
        ],
      });
      expect(JSON.stringify(buyerView.packs)).not.toContain("canResend");
      expect(JSON.stringify(buyerView.packs)).not.toContain(
        "/reservation/access/"
      );
      expect(JSON.stringify(buyerView.packs)).not.toContain(holderEmail);
      expect(await readPassViews(holder, firstDay)).toEqual({
        unlimited: [],
        packs: { held: [], boughtForOthers: [] },
      });
      await testDatabase!.pool.query(
        "update pass_purchases set gift_claimed_at = $2 where id = $1",
        [passId, firstDay]
      );
      expect(
        (await readPassViews(holder, "2026-03-15T22:59:59Z")).unlimited
      ).toMatchObject([{ status: "upcoming" }]);
      expect(await readPassViews(holder, firstDay)).toMatchObject({
        unlimited: [
          {
            status: "active",
            day: 1,
            daysLeft: 30,
            accessPath: `/en-US/reservation/access/${passId}`,
          },
        ],
        packs: { held: [], boughtForOthers: [] },
      });
      expect(
        (await readPassViews(holder, "2026-04-14T22:00:00Z")).unlimited
      ).toMatchObject([{ status: "expired" }]);
      await testDatabase!.pool.query(
        "update pass_purchases set status = 'withdrawn', access_ends_on = '2026-03-17' where id = $1",
        [passId]
      );
      expect(
        (await readPassViews(holder, "2026-03-16T22:59:59Z")).unlimited
      ).toMatchObject([{ status: "active", day: 1, daysLeft: 1 }]);
      expect(
        (await readPassViews(holder, "2026-03-16T23:00:00Z")).unlimited
      ).toMatchObject([{ status: "ended" }]);
    });

    test("scopes Entry pack payment to an owner-matched reservation and booking to the pack's validity", async () => {
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
      const laterProviderOnlyDotyposReservationId =
        DotyposReservationIdSchema.make(`dotypos-${uniqueId()}`);

      await insertAuthUser(account, testEmailAddress(`h-${account}`));
      await testDatabase!.pool.query(
        `update customer_accounts set dotypos_customer_id = $2 where id = $1`,
        [account, dotyposCustomerId]
      );
      await insertWorkspaceReservation({
        id: matchedWorkspaceReservationId,
        dotyposCustomerId,
        dotyposReservationId: matchedDotyposReservationId,
        authorAccountId: account,
      });
      await insertWorkspaceReservation({
        id: foreignWorkspaceReservationId,
        dotyposCustomerId: foreignCustomerId,
        dotyposReservationId: foreignDotyposReservationId,
        authorAccountId: fixtureReservationAuthorId,
      });

      const passId = uniqueId();
      await testDatabase!.pool.query(
        `insert into orders (id, kind, dotypos_customer_id, payment_state, fulfillment_state, paid_at)
         values ($1, 'pass-purchase', $2, 'paid', 'not_started', '2000-01-01T00:00:00Z')`,
        [passId, dotyposCustomerId]
      );
      await testDatabase!.pool.query(
        `insert into pass_purchases
           (id, buyer_account_id, holder_account_id, product, tier, entry_count, status, valid_from, valid_until, quote, locale, created_at)
         values ($1, $2, $2, 'entry-pack', 'open-space', 5, 'active', '2000-01-01', '2000-03-01', '{}', 'en-US', now())`,
        [passId, account]
      );
      await testDatabase!.pool.query(
        `insert into pass_entry_claims (reservation_id, pass_id, date, status)
         values ($1, $3, '2000-01-01', 'consumed'), ($2, $3, '2000-01-04', 'consumed')`,
        [matchedWorkspaceReservationId, foreignWorkspaceReservationId, passId]
      );

      const history = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomerReservationHistoryService;
          return yield* service.load(
            { accountId: account, dotyposCustomerId },
            { includeEntryPackPayment: true }
          );
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
                id: laterProviderOnlyDotyposReservationId,
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
      expect(summaries.map((summary) => summary.paidWithEntryPack)).toEqual([
        undefined,
        undefined,
        undefined,
        true,
      ]);
      expect(JSON.stringify(history)).not.toContain(passId);
      expect(summaries.map((summary) => summary.id)).toEqual([
        foreignDotyposReservationId,
        laterProviderOnlyDotyposReservationId,
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

      const reservedEntry = workspaceReservationIdSchema.make(uniqueId());
      const releasedEntry = workspaceReservationIdSchema.make(uniqueId());
      for (const id of [reservedEntry, releasedEntry]) {
        await insertWorkspaceReservation({
          id,
          dotyposCustomerId,
          dotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-${uniqueId()}`
          ),
          authorAccountId: account,
        });
      }
      await testDatabase!.pool.query(
        `insert into pass_entry_claims (reservation_id, pass_id, date, status)
         values ($1, $3, '2000-01-02', 'reserved'), ($2, $3, '2000-01-03', 'released')`,
        [reservedEntry, releasedEntry, passId]
      );

      const paidAt = Temporal.Instant.from("2000-01-01T00:00:00Z");
      const [lastDay, expiry] = await Effect.runPromise(
        Effect.gen(function* () {
          yield* TestClock.setTime(
            Temporal.Instant.from("2000-02-29T22:59:59Z").epochMilliseconds
          );
          const lastDay = yield* loadAccountPasses("en-US");
          yield* TestClock.adjust("1 second");
          const expiry = yield* loadAccountPasses("en-US");
          return [lastDay, expiry] as const;
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              testDatabaseLayer(),
              TestClock.layer(),
              Layer.mock(CurrentCustomerAccount, {
                peek: Effect.succeed({
                  kind: "unlinked",
                  reviewMarker: "absent",
                  session: {
                    accountId: account,
                    email: reservationCustomerEmailSchema.make(
                      testEmailAddress(`h-${account}`)
                    ),
                    deletionRequested: false,
                    displayName: null,
                    accountCreatedAt: paidAt,
                    accountUpdatedAt: paidAt,
                  },
                }),
              })
            )
          )
        )
      );
      expect(lastDay).toEqual({
        boughtForOthers: [],
        held: [
          expect.objectContaining({
            status: "active",
            entriesLeft: 2,
            lastUsableDay: "Feb 29, 2000",
            bookPath: `/en-US/reservation/cowork?pass=${passId}`,
          }),
        ],
      });
      expect(expiry).toEqual({
        boughtForOthers: [],
        held: [expect.objectContaining({ status: "expired" })],
      });
      expect(JSON.stringify(expiry)).not.toContain(passId);
    });

    test("keeps bought gifts and holder passes separate", async () => {
      const buyer = customerAccountIdSchema.make(uniqueId());
      const holder = customerAccountIdSchema.make(uniqueId());
      const other = customerAccountIdSchema.make(uniqueId());
      const holderEmail = testEmailAddress(`recipient-${holder}`);
      const buyerEmail = testEmailAddress(`buyer-${buyer}`);
      await insertAuthUser(buyer, buyerEmail);
      await insertAuthUser(holder, holderEmail);
      await insertAuthUser(other, testEmailAddress(`other-${other}`));
      await testDatabase!.pool.query(
        `update auth."user" set name = 'Old Auth Name' where id = $1`,
        [buyer]
      );
      const giftId = uniqueId();
      const unpaidId = uniqueId();
      await testDatabase!.pool.query(
        `insert into orders (id, kind, dotypos_customer_id, payment_state, fulfillment_state, paid_at)
         values ($1, 'pass-purchase', $3, 'paid', 'not_started', now()),
                ($2, 'pass-purchase', $3, 'not_started', 'not_started', null)`,
        [giftId, unpaidId, uniqueDotyposId()]
      );
      await testDatabase!.pool.query(
        `insert into pass_purchases
           (id, buyer_account_id, holder_account_id, product, tier, entry_count, status, valid_from, valid_until, quote, locale, created_at)
         values ($1, $3, $4, 'entry-pack', 'open-space', 5, 'active', '2026-01-01', '2099-01-01', '{}', 'en-US', now()),
                ($2, $3, $4, 'entry-pack', 'open-space', 5, 'pending_payment', '2026-01-01', '2099-01-01', '{}', 'en-US', now())`,
        [giftId, unpaidId, buyer, holder]
      );

      const createdAt = Temporal.Instant.from("2026-01-01T00:00:00Z");
      let profileLastName = "Example";
      const profileLayer = Layer.mock(CustomerProfileService, {
        load: () =>
          Effect.succeed({
            firstName: "Pat",
            lastName: profileLastName,
            phone: null,
            billing: null,
          }),
      });
      const loadFor = (
        accountId: CustomerAccountId,
        verifiedSignInAt?: Temporal.Instant
      ) =>
        Effect.runPromise(
          loadAccountPasses("en-US", profileLayer).pipe(
            Effect.provide(
              Layer.mergeAll(
                testDatabaseLayer(),
                Layer.mock(CurrentCustomerAccount, {
                  peek: Effect.succeed({
                    kind: "unlinked",
                    reviewMarker: "absent",
                    session: {
                      accountId,
                      email: reservationCustomerEmailSchema.make(
                        testEmailAddress(`session-${accountId}`)
                      ),
                      deletionRequested: false,
                      displayName: null,
                      accountCreatedAt: createdAt,
                      accountUpdatedAt: createdAt,
                      verifiedSignInAt,
                    },
                  }),
                })
              )
            )
          )
        );

      const buyerView = await loadFor(buyer);
      expect(buyerView).toEqual({
        held: [],
        boughtForOthers: [
          {
            orderId: giftId,
            statusPath: `/en-US/reservation/status/${giftId}`,
            tier: "Open Space",
            product: "entry-pack",
            entryCount: 5,
            maskedHolderEmail: maskEmailAddress(holderEmail),
            invitation: "not_sent",
            claimed: false,
            canResend: true,
          },
        ],
      });
      expect(JSON.stringify(buyerView)).not.toContain(holderEmail);
      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = now() where id = $1`,
        [holder]
      );
      expect(await loadFor(buyer)).toEqual({
        held: [],
        boughtForOthers: [
          expect.objectContaining({
            orderId: giftId,
            canResend: false,
            maskedHolderEmail: undefined,
          }),
        ],
      });
      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = null where id = $1`,
        [holder]
      );
      expect(await loadFor(holder)).toEqual({
        boughtForOthers: [],
        held: [
          expect.objectContaining({
            gift: { orderId: giftId, buyerName: undefined },
            bookPath: `/en-US/reservation/cowork?pass=${giftId}`,
          }),
        ],
      });
      await testDatabase!.pool.query(
        `update customer_accounts set dotypos_customer_id = $2 where id = $1`,
        [buyer, uniqueDotyposId()]
      );
      expect(await loadFor(holder)).toEqual({
        boughtForOthers: [],
        held: [
          expect.objectContaining({
            gift: { orderId: giftId, buyerName: "Pat Example" },
            bookPath: `/en-US/reservation/cowork?pass=${giftId}`,
          }),
        ],
      });
      expect(await loadFor(other)).toEqual({ boughtForOthers: [], held: [] });

      profileLastName = buyerEmail;
      await testDatabase!.pool.query(
        `update pass_purchases set gift_issued_at = now() where id = $1`,
        [giftId]
      );
      await testDatabase!.pool.query(
        `with attempt as (
           insert into payment_attempts
             (order_id, provider, state, amount_value, amount_exponent, currency)
           values ($1, 'internal', 'paid', 0, 2, 'CZK')
           returning id
         )
         update orders set active_payment_attempt_id = attempt.id from attempt
         where orders.id = $1`,
        [giftId]
      );
      await testDatabase!.pool.query(
        `update auth."user" set email_verified = true where id = $1`,
        [holder]
      );
      const beforeClaim = await loadFor(holder);
      expect(beforeClaim).toEqual({
        boughtForOthers: [],
        held: [
          expect.objectContaining({
            gift: { orderId: giftId, buyerName: undefined },
          }),
        ],
      });
      expect(JSON.stringify(beforeClaim)).not.toContain(buyerEmail);
      expect(JSON.stringify(beforeClaim)).not.toContain("bookPath");

      expect(await loadFor(holder, createdAt)).toEqual(beforeClaim);
      const verifiedSignInAt = Temporal.Now.instant().add({ seconds: 1 });
      expect(await loadFor(other, verifiedSignInAt)).toEqual({
        boughtForOthers: [],
        held: [],
      });
      expect(await loadFor(buyer)).toMatchObject({
        boughtForOthers: [{ orderId: giftId, claimed: false }],
      });
      expect(await loadFor(holder, verifiedSignInAt)).toEqual({
        boughtForOthers: [],
        held: [
          expect.objectContaining({
            gift: { orderId: giftId, buyerName: undefined },
            bookPath: `/en-US/reservation/cowork?pass=${giftId}`,
          }),
        ],
      });
      expect(await loadFor(buyer)).toMatchObject({
        boughtForOthers: [{ orderId: giftId, claimed: true, canResend: false }],
      });

      profileLastName = "Example";
      expect(await loadFor(holder)).toMatchObject({
        held: [{ gift: { buyerName: "Pat Example" } }],
      });
      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = now() where id = $1`,
        [buyer]
      );
      expect(await loadFor(holder)).toEqual({
        boughtForOthers: [],
        held: [
          expect.objectContaining({
            gift: { orderId: giftId, buyerName: undefined },
          }),
        ],
      });
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
          authorAccountId: entry.author,
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
      account: ReservationHistoryAccount,
      layer: ReturnType<typeof makeHistoryLayer>,
      options?: ReservationHistoryOptions
    ) => {
      const history = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomerReservationHistoryService;
          return yield* service.load(account, options);
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

    test("skips party names for a caller that never shows them", async () => {
      const seeded = await seedParties();
      const customerReads: DotyposCustomerId[][] = [];
      const past = await loadPast(
        seeded.account,
        makeHistoryLayer(seeded.reservations, {
          customers: seeded.customers,
          customerReads,
        }),
        { includePartyNames: false }
      );

      expect(past.map(({ party }) => party)).toEqual([
        { kind: "booked-by-deleted-account" },
        { kind: "booked-by", authorName: null },
        { kind: "booked-for", customerName: null },
        undefined,
        undefined,
      ]);
      expect(customerReads).toEqual([]);
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
      ]);
    });

    test("loads only the authored reservations of an account without a linked customer", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const otherAuthor = customerAccountIdSchema.make(uniqueId());
      const bookedForCustomerId = DotyposCustomerIdSchema.make(
        uniqueDotyposId()
      );
      await insertCustomerAccount({ id: account });
      await insertCustomerAccount({ id: otherAuthor });

      const seeded = [
        { key: "booked-for", author: account },
        { key: "other-author", author: otherAuthor },
      ] as const;
      const reservations: DotyposReservation[] = [];
      const workspaceIds = new Map<string, WorkspaceReservationId>();
      for (const [index, entry] of seeded.entries()) {
        const workspace = workspaceReservationIdSchema.make(
          `workspace-${uniqueId()}`
        );
        const dotypos = DotyposReservationIdSchema.make(
          `dotypos-${uniqueId()}`
        );
        workspaceIds.set(entry.key, workspace);
        await insertWorkspaceReservation({
          id: workspace,
          dotyposCustomerId: bookedForCustomerId,
          dotyposReservationId: dotypos,
          authorAccountId: entry.author,
        });
        reservations.push(
          makeDotyposReservation({
            id: dotypos,
            _customerId: bookedForCustomerId,
            startDate: `2000-03-0${index + 1}T10:00:00.000Z`,
            endDate: `2000-03-0${index + 1}T11:00:00.000Z`,
          })
        );
      }

      const past = await loadPast(
        { accountId: account },
        makeHistoryLayer(reservations, {
          customers: [
            makeDotyposCustomer(bookedForCustomerId, "Karla", "Ukázková"),
          ],
        })
      );

      expect(past.map(({ id, party }) => ({ id, party }))).toEqual([
        {
          id: workspaceIds.get("booked-for"),
          party: { kind: "booked-for", customerName: "Karla Ukázková" },
        },
      ]);
    });

    const seedOwnReservations = async (
      entries: readonly {
        readonly key: string;
        readonly stage: ReservationFixtureStage;
        readonly status: "NEW" | "CONFIRMED" | "CANCELLED";
        readonly startDate?: string;
        readonly endDate?: string;
        readonly seats?: string;
        readonly details?: StoredWorkspaceReservationDetails;
      }[]
    ) => {
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = DotyposCustomerIdSchema.make(uniqueDotyposId());
      await insertCustomerAccount({ id: account, dotyposCustomerId });
      const reservations: DotyposReservation[] = [];
      const ids = new Map<
        string,
        {
          readonly workspace: WorkspaceReservationId;
          readonly dotypos: DotyposReservationId;
        }
      >();
      for (const [index, entry] of entries.entries()) {
        const workspace = workspaceReservationIdSchema.make(
          `workspace-${uniqueId()}`
        );
        const dotypos = DotyposReservationIdSchema.make(
          `dotypos-${uniqueId()}`
        );
        ids.set(entry.key, { workspace, dotypos });
        await insertWorkspaceReservation({
          id: workspace,
          dotyposCustomerId,
          dotyposReservationId: dotypos,
          authorAccountId: account,
          stage: entry.stage,
          ...(entry.details && { details: entry.details }),
        });
        const reservation = makeDotyposReservation({
          id: dotypos,
          _customerId: dotyposCustomerId,
          seats: entry.seats ?? "2",
          status: entry.status,
        });
        reservations.push({
          ...reservation,
          startDate: entry.startDate ?? `2000-04-0${index + 1}T10:00:00.000Z`,
          endDate: entry.endDate ?? `2000-04-0${index + 1}T11:00:00.000Z`,
        });
      }
      const idsOf = (key: string) => {
        const entry = ids.get(key);
        if (!entry) throw new Error(`Unknown reservation ${key}`);
        return entry;
      };
      return {
        account: { accountId: account, dotyposCustomerId },
        reservations,
        idsOf,
      };
    };

    test("sorts history by readable starts and hides unreadable seats", async () => {
      const seeded = await seedOwnReservations([
        {
          key: "newest",
          stage: { reservation: "confirmed" },
          status: "CONFIRMED",
          startDate: "2000-04-03T10:00:00.000Z",
          endDate: "not-a-date",
        },
        {
          key: "unreadable-end",
          stage: { reservation: "confirmed" },
          status: "CONFIRMED",
          startDate: "2000-04-02T10:00:00.000Z",
          endDate: "not-a-date",
          seats: "abc",
        },
        {
          key: "unreadable-start",
          stage: { reservation: "confirmed" },
          status: "CONFIRMED",
          startDate: "not-a-date",
          endDate: "not-a-date",
        },
      ]);

      const history = await Effect.gen(function* () {
        const service = yield* CustomerReservationHistoryService;
        return yield* service.load(seeded.account);
      }).pipe(
        Effect.provide(makeHistoryLayer(seeded.reservations)),
        Effect.runPromise
      );
      if (history.kind !== "available") throw new Error("History unavailable");

      expect(history.groups.unavailable.map(({ id }) => id)).toEqual([
        seeded.idsOf("newest").workspace,
        seeded.idsOf("unreadable-end").workspace,
        seeded.idsOf("unreadable-start").workspace,
      ]);
      expect(history.groups.unavailable[1]?.seats).toBeNull();
    });

    test("shows an early-setup meeting room at its booked start with its setup start", async () => {
      const seeded = await seedOwnReservations([
        {
          key: "early-setup",
          stage: { reservation: "confirmed" },
          status: "CONFIRMED",
          startDate: "2000-04-02T09:45:00.000Z",
          endDate: "2000-04-02T11:00:00.000Z",
          details: { kind: "meeting-room", earlySetup: true },
        },
        {
          // Starts after the setup start but before the booked start.
          key: "between",
          stage: { reservation: "confirmed" },
          status: "CONFIRMED",
          startDate: "2000-04-02T09:50:00.000Z",
          endDate: "2000-04-02T10:50:00.000Z",
          details: { kind: "meeting-room" },
        },
        {
          key: "without-setup",
          stage: { reservation: "confirmed" },
          status: "CONFIRMED",
          startDate: "2000-04-01T09:45:00.000Z",
          endDate: "2000-04-01T11:00:00.000Z",
          details: { kind: "meeting-room" },
        },
      ]);

      const history = await Effect.gen(function* () {
        const service = yield* CustomerReservationHistoryService;
        return yield* service.load(seeded.account);
      }).pipe(
        Effect.provide(makeHistoryLayer(seeded.reservations)),
        Effect.runPromise
      );
      if (history.kind !== "available") throw new Error("History unavailable");

      const summaries = Object.values(history.groups).flat();
      const summaryOf = (key: string) =>
        summaries.find(({ id }) => id === seeded.idsOf(key).workspace);
      expect(summaryOf("early-setup")).toMatchObject({
        startsAt: "2000-04-02T10:00:00.000Z",
        endsAt: "2000-04-02T11:00:00.000Z",
        setupStartsAt: "2000-04-02T09:45:00.000Z",
      });
      expect(summaryOf("without-setup")).toMatchObject({
        startsAt: "2000-04-01T09:45:00.000Z",
        endsAt: "2000-04-01T11:00:00.000Z",
      });
      expect(summaryOf("without-setup")).not.toHaveProperty("setupStartsAt");
      // Ordered by booked start, newest first.
      expect(
        summaries
          .map(({ id }) => id)
          .filter((id) =>
            ["early-setup", "between"].some(
              (key) => seeded.idsOf(key).workspace === id
            )
          )
      ).toEqual([
        seeded.idsOf("early-setup").workspace,
        seeded.idsOf("between").workspace,
      ]);
    });

    test("sorts an impossible start last and reads seats as positive whole numbers", async () => {
      // Every end is unreadable so the history keeps its order in one group.
      const seeded = await seedOwnReservations([
        {
          key: "impossible-start",
          stage: { reservation: "confirmed" },
          status: "CONFIRMED",
          startDate: "2000-04-31T10:00:00.000Z",
          endDate: "not-a-date",
        },
        {
          key: "newest",
          stage: { reservation: "confirmed" },
          status: "CONFIRMED",
          startDate: "2000-04-03T10:00:00.000Z",
          endDate: "not-a-date",
          seats: " 2",
        },
        {
          key: "zero-seats",
          stage: { reservation: "confirmed" },
          status: "CONFIRMED",
          startDate: "2000-04-02T10:00:00.000Z",
          endDate: "not-a-date",
          seats: "0",
        },
      ]);

      const history = await Effect.gen(function* () {
        const service = yield* CustomerReservationHistoryService;
        return yield* service.load(seeded.account);
      }).pipe(
        Effect.provide(makeHistoryLayer(seeded.reservations)),
        Effect.runPromise
      );
      if (history.kind !== "available") throw new Error("History unavailable");

      expect(
        history.groups.unavailable.map(({ id, seats }) => ({ id, seats }))
      ).toEqual([
        { id: seeded.idsOf("newest").workspace, seats: 2 },
        { id: seeded.idsOf("zero-seats").workspace, seats: null },
        { id: seeded.idsOf("impossible-start").workspace, seats: 2 },
      ]);
    });

    // Reservation details may come from a shared snapshot taken before
    // Workspace confirmed the paid hold in Dotypos.
    test("shows a booking Workspace confirmed as confirmed while its details still say NEW", async () => {
      const seeded = await seedOwnReservations([
        { key: "unpaid", stage: { reservation: "held" }, status: "NEW" },
        { key: "paid", stage: { reservation: "confirmed" }, status: "NEW" },
      ]);

      const past = await loadPast(
        seeded.account,
        makeHistoryLayer(seeded.reservations)
      );

      expect(past.map(({ id, status }) => ({ id, status }))).toEqual([
        { id: seeded.idsOf("paid").workspace, status: "confirmed" },
        { id: seeded.idsOf("unpaid").workspace, status: "pending" },
      ]);
    });

    test("lets a cancellation win over a failure that needs attention", async () => {
      const paidFailed = {
        reservation: "confirmed",
        payment: "paid",
        fulfillment: "failed",
      } as const;
      const seeded = await seedOwnReservations([
        {
          key: "expired",
          stage: { reservation: "hold_expired" },
          status: "NEW",
        },
        {
          key: "cancelled-in-dotypos",
          stage: paidFailed,
          status: "CANCELLED",
        },
        { key: "fulfillment-failed", stage: paidFailed, status: "CONFIRMED" },
        {
          key: "cancellation-failed",
          stage: { reservation: "cancellation_failed", payment: "paid" },
          status: "CONFIRMED",
        },
        {
          key: "cancelled",
          stage: { reservation: "cancelled", payment: "cancelled" },
          status: "CONFIRMED",
        },
        {
          key: "confirmed-in-dotypos",
          stage: { reservation: "confirming", payment: "paid" },
          status: "CONFIRMED",
        },
      ]);

      const past = await loadPast(
        seeded.account,
        makeHistoryLayer(seeded.reservations)
      );

      expect(
        Object.fromEntries(past.map(({ id, status }) => [id, status]))
      ).toEqual({
        [seeded.idsOf("expired").workspace]: "cancelled",
        [seeded.idsOf("cancelled-in-dotypos").workspace]: "cancelled",
        [seeded.idsOf("fulfillment-failed").workspace]: "requires-attention",
        [seeded.idsOf("cancellation-failed").workspace]: "requires-attention",
        [seeded.idsOf("cancelled").workspace]: "cancelled",
        [seeded.idsOf("confirmed-in-dotypos").workspace]: "confirmed",
      });
    });

    test("reads a hold whose payment ended unpaid as not booked at its booked time", async () => {
      const startDate = "2000-01-01T09:00:00.000Z";
      const endDate = "2000-01-01T17:00:00.000Z";
      const seeded = await seedOwnReservations([
        {
          key: "failed",
          stage: { reservation: "held", payment: "failed" },
          status: "NEW",
          startDate,
          endDate,
        },
        {
          key: "cancelled",
          stage: { reservation: "held", payment: "cancelled" },
          status: "NEW",
        },
        {
          key: "expired",
          stage: { reservation: "held", payment: "expired" },
          status: "NEW",
        },
        {
          key: "hold-expired",
          stage: { reservation: "hold_expired", payment: "failed" },
          status: "NEW",
        },
        {
          key: "retrying",
          stage: { reservation: "held", payment: "pending" },
          status: "NEW",
        },
        {
          key: "retried-then-paid",
          stage: { reservation: "confirmed", payment: "paid" },
          status: "NEW",
        },
        {
          key: "confirmed-in-dotypos",
          stage: { reservation: "held", payment: "failed" },
          status: "CONFIRMED",
        },
      ]);

      const past = await loadPast(
        seeded.account,
        makeHistoryLayer(seeded.reservations)
      );

      expect(
        Object.fromEntries(past.map(({ id, status }) => [id, status]))
      ).toEqual({
        [seeded.idsOf("failed").workspace]: "cancelled",
        [seeded.idsOf("cancelled").workspace]: "cancelled",
        [seeded.idsOf("expired").workspace]: "cancelled",
        [seeded.idsOf("hold-expired").workspace]: "cancelled",
        [seeded.idsOf("retrying").workspace]: "pending",
        [seeded.idsOf("retried-then-paid").workspace]: "confirmed",
        [seeded.idsOf("confirmed-in-dotypos").workspace]: "confirmed",
      });
      const failed = past.find(
        ({ id }) => id === seeded.idsOf("failed").workspace
      );
      expect(
        failed && { startsAt: failed.startsAt, endsAt: failed.endsAt }
      ).toEqual({ startsAt: startDate, endsAt: endDate });
    });

    // A shared snapshot of the list can predate one of these bookings, so
    // the records reader needs them to fill the gap.
    test("tells the records reader which of the customer's reservations Workspace recorded", async () => {
      const seeded = await seedOwnReservations([
        {
          key: "first",
          stage: { reservation: "confirmed" },
          status: "CONFIRMED",
        },
        { key: "second", stage: { reservation: "held" }, status: "NEW" },
      ]);
      const customerListReads: Parameters<
        ReservationRecords["Service"]["listForCustomer"]
      >[0][] = [];

      const past = await loadPast(
        seeded.account,
        makeHistoryLayer(seeded.reservations, { customerListReads })
      );

      expect(past.map(({ id }) => id)).toEqual([
        seeded.idsOf("second").workspace,
        seeded.idsOf("first").workspace,
      ]);
      expect(
        customerListReads.map(({ customerId, recordedIds }) => ({
          customerId,
          recordedIds: recordedIds.toSorted(),
        }))
      ).toEqual([
        {
          customerId: seeded.account.dotyposCustomerId,
          recordedIds: [
            seeded.idsOf("first").dotypos,
            seeded.idsOf("second").dotypos,
          ].toSorted(),
        },
      ]);
    });
  }
);
