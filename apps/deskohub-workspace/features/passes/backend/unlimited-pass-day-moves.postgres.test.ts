import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposService,
  DotyposTableSchema,
  DotyposUnavailable,
  DotyposUncertain,
} from "@deskohub/dotypos";
import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
import { eq } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { passPurchases } from "@/db/schema";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import { withWorkspaceReservationCapacity } from "@/features/checkout/backend/reservation/dotypos-reservation.adapter";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation/workspace-table-assignment.service";
import { orderIdSchema } from "@/features/order";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { GoogleCalendarWorkspaceLimitationsService } from "@/features/reservation/backend/google-calendar-workspace-limitations.service";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import {
  holdPostgresTransaction,
  waitForAdvisoryLockWaiter,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { CoworkPassesReleaseGate } from "./cowork-passes-release-gate";
import { PassDayMoves } from "./unlimited-pass-day-moves";
import { createUnlimitedPassDayHold } from "./unlimited-pass-dotypos-holds";
import { releaseUnlimitedPassDays } from "./unlimited-pass-holds";

const database = await createWorkspacePostgresSuiteDatabase("pass_day_moves");
afterAll(() => database?.close());

const date = plainDateStringSchema.make("2027-03-28");
const beforeMidnight = Temporal.Instant.from("2027-03-27T22:55:00Z");
const afterMidnight = Temporal.Instant.from("2027-03-27T23:05:00Z");
const selection = {
  kind: "cowork",
  entryTier: "reserved-desk",
  date,
  coffee: true,
} as const;
const ordinaryInterval = getCoworkReservationInterval("reserved-desk", date);
const provider = makeInMemoryDotypos();
let nextTable = 101;

describe.skipIf(!database)("Unlimited Open Space re-seating", () => {
  if (!database) return;
  const { pool } = database;

  const fixture = async ({
    tier = "open-space",
    status = "active",
    gate = true,
  }: {
    readonly tier?: "open-space" | "reserved-desk";
    readonly status?: "active" | "withdrawn";
    readonly gate?: boolean;
  } = {}) => {
    const passId = orderIdSchema.make(crypto.randomUUID());
    const buyer = crypto.randomUUID();
    const holder = crypto.randomUUID();
    const customerId = DotyposCustomerIdSchema.make(String(nextTable + 1000));
    const makeTable = (tags: string[]) =>
      Schema.decodeSync(DotyposTableSchema)({
        _cloudId: "1",
        id: String(nextTable++),
        display: true,
        enabled: true,
        name: "Synthetic table",
        seats: "1",
        tags,
      });
    const source = makeTable(["cowork:open-space", "cowork:reserved-desk"]);
    const target = makeTable(["cowork:open-space"]);
    const day = {
      serviceDate: Temporal.PlainDate.from(date),
      tableId: source.id,
      interval: getCoworkReservationInterval(tier, date),
    };
    const generation = crypto.randomUUID();
    const original = await Effect.runPromise(
      createUnlimitedPassDayHold({
        passId,
        customerId,
        day,
        generation,
        coffee: true,
      }).pipe(Effect.provide(provider.layer))
    );
    await Effect.runPromise(provider.service.confirmReservation(original.id));

    await pool.query("insert into customer_accounts (id) values ($1), ($2)", [
      buyer,
      holder,
    ]);
    await pool.query(
      `insert into orders (id, kind, dotypos_customer_id, payment_state, fulfillment_state, paid_at, fulfilled_at)
       values ($1, 'pass-purchase', $2, 'paid', 'fulfilled', now(), now())`,
      [passId, customerId]
    );
    await pool.query(
      `insert into pass_purchases (id, buyer_account_id, holder_account_id, product, tier, status,
        valid_from, valid_until, access_ends_on, quote, locale, created_at, unlimited_coffee)
       values ($1, $2, $3, 'unlimited', $4, $5, $6::date, $6::date + 30,
        case when $5 = 'withdrawn' then $6::date end, '{}', 'en-US', now(), $7)`,
      [
        passId,
        buyer,
        holder,
        tier,
        status,
        date,
        tier === "open-space" ? true : null,
      ]
    );
    const {
      rows: [local],
    } = await pool.query<{ id: string }>(
      `insert into workspace_reservations
       (checkout_attempt_key, dotypos_customer_id, dotypos_reservation_id, author_account_id,
        reservation_state, payment_state, fulfillment_state, reservation_details, locale,
        pass_id, service_date, pass_day_table_id, pass_day_hold_requested_at, pass_day_hold_generation,
        paid_at, fulfilled_at, reservation_confirmed_at)
       values (uuid_generate_v7(), $1, $2, $3, 'confirmed', 'paid', 'fulfilled', '{}',
        'en-US', $4, $5, $6, now(), $7, now(), now(), now()) returning id`,
      [customerId, original.id, buyer, passId, date, source.id, generation]
    );
    const reservationId = local!.id;
    const readDay = async () =>
      (
        await pool.query("select * from workspace_reservations where id = $1", [
          reservationId,
        ])
      ).rows[0]!;
    const moves = async () =>
      (
        await pool.query(
          "select * from unlimited_pass_day_moves where reservation_id = $1",
          [reservationId]
        )
      ).rows;
    const availability = await readDay();
    const getRecord = (id: typeof original.id) =>
      Effect.runPromise(provider.service.getReservationWithoutCustomer(id));
    const targetHasMoveClaim = Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      const serviceDate = Temporal.PlainDate.from(date);
      const claims = yield* repository.selectPendingPassDayCapacity({
        first: serviceDate,
        last: serviceDate,
      });
      return claims.some(
        (claim) => claim.moveClaim && claim.tableId === target.id
      );
    });
    const baseProvider = {
      ...provider.service,
      getTables: () => Effect.succeed([source, target]),
    };
    const runtime = (
      overrides: Partial<typeof DotyposService.Service> = {}
    ) => {
      const dependencies = Layer.mergeAll(
        database.layer,
        WorkspaceDatabaseAdvisoryLock.makeLayer(database.databasePool),
        WorkspaceReservationRepository.Default.pipe(
          Layer.provide(database.layer)
        ),
        CoworkPassesReleaseGate.fromDecision(gate),
        Layer.mock(GoogleCalendarWorkspaceLimitationsService, {
          listLimitations: () => Effect.succeed([]),
        }),
        Layer.succeed(DotyposService, { ...baseProvider, ...overrides })
      );
      return Layer.mergeAll(
        WorkspaceTableAssignmentService.Default,
        WorkspaceAvailabilityService.Default
      ).pipe(
        Layer.provideMerge(PassDayMoves.Default),
        Layer.provide(AdvisoryAvailabilityInventory.Provider),
        Layer.provideMerge(dependencies),
        Layer.provideMerge(TestClock.layer())
      );
    };
    const assign = Effect.flatMap(
      WorkspaceTableAssignmentService,
      (assignment) =>
        assignment.assignTableId(selection, { allowPassDayMove: true })
    );
    const reserve = (now = beforeMidnight) =>
      Effect.andThen(
        TestClock.setTime(now.epochMilliseconds),
        withWorkspaceReservationCapacity(ordinaryInterval, assign)
      );
    return {
      availability,
      original,
      source,
      target,
      customerId,
      passId,
      readDay,
      moves,
      getRecord,
      runtime,
      reserve,
      assign,
      targetHasMoveClaim,
    };
  };

  test("normal allocation frees a shared desk on a Prague DST date and preserves the paid day", async () => {
    const {
      availability,
      original,
      source,
      target,
      readDay,
      moves,
      getRecord,
      runtime,
      reserve,
      passId,
    } = await fixture();
    await Effect.runPromise(
      Effect.andThen(
        TestClock.setTime(beforeMidnight.epochMilliseconds),
        Effect.flatMap(WorkspaceAvailabilityService, (availability) =>
          availability.ensureAvailable(selection, { allowPassDayMove: true })
        )
      ).pipe(Effect.provide(runtime()))
    );
    expect(await moves()).toEqual([]);
    expect((await getRecord(original.id)).status).toBe("CONFIRMED");
    expect(
      await Effect.runPromise(reserve().pipe(Effect.provide(runtime())))
    ).toBe(source.id);
    const [audit] = await moves();
    const day = await readDay();
    expect(day).toMatchObject({
      id: availability.id,
      pass_id: passId,
      pass_day_table_id: target.id,
      dotypos_reservation_id: audit.target_reservation_id,
      reservation_state: "confirmed",
      payment_state: "paid",
      fulfillment_state: "fulfilled",
      paid_at: availability.paid_at,
      fulfilled_at: availability.fulfilled_at,
      reservation_confirmed_at: availability.reservation_confirmed_at,
    });
    expect(audit).toMatchObject({
      source_reservation_id: original.id,
      source_table_id: source.id,
      target_table_id: target.id,
      attached_at: "2027-03-27 22:55:00+00",
      settled_at: "2027-03-27 22:55:00+00",
    });
    const replacement = await getRecord(day.dotypos_reservation_id);
    expect(replacement).toMatchObject({
      _tableId: target.id,
      _customerId: original._customerId,
      status: "CONFIRMED",
      seats: original.seats,
      startDate: original.startDate,
      endDate: original.endDate,
    });
    expect(replacement.note).toContain("Káva: ano");
    expect((await getRecord(original.id)).status).toBe("CANCELLED");
    expect(
      (
        await pool.query("select id from orders where id in ($1, $2)", [
          passId,
          day.id,
        ])
      ).rows
    ).toEqual([{ id: passId }]);
  });

  test.each([
    ["Prague today before UTC midnight", { now: afterMidnight }],
    ["Reserved Desk", { tier: "reserved-desk" as const }],
    ["withdrawn pass", { status: "withdrawn" as const }],
    ["closed flag", { gate: false }],
  ])("does not move %s", async (_label, options) => {
    const { original, readDay, moves, getRecord, runtime, reserve } =
      await fixture(options);
    const result = await Effect.runPromise(
      reserve("now" in options ? options.now : beforeMidnight).pipe(
        Effect.result,
        Effect.provide(runtime())
      )
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "TableAssignmentUnavailableError" },
    });
    expect(await moves()).toEqual([]);
    expect((await readDay()).dotypos_reservation_id).toBe(original.id);
    expect((await getRecord(original.id)).status).toBe("CONFIRMED");
  });

  test("uses ordinary capacity without moving a pass day when another desk is free", async () => {
    const { source, target, runtime, reserve, moves } = await fixture();
    const layer = runtime({
      getTables: () =>
        Effect.succeed([
          source,
          { ...target, tags: ["cowork:open-space", "cowork:reserved-desk"] },
        ]),
    });
    expect(await Effect.runPromise(reserve().pipe(Effect.provide(layer)))).toBe(
      target.id
    );
    expect(await moves()).toEqual([]);
  });

  test.each([
    "createReservation",
    "confirmReservation",
    "cancelReservation",
  ] as const)(
    "reconciles a landed %s whose reply was lost",
    async (operation) => {
      const { source, original, runtime, reserve, moves, getRecord, readDay } =
        await fixture();
      let creates = 0;
      let confirmations = 0;
      let cancellations = 0;
      const lost = new DotyposUncertain({
        operation:
          operation === "createReservation"
            ? operation
            : "setReservationStatusIfMatches",
        reason: "timeout",
      });
      const layer = runtime({
        createReservation: (input) => {
          creates++;
          expect(input.singleAttempt).toBe(true);
          return provider.service
            .createReservation(input)
            .pipe(
              Effect.tap(() =>
                operation === "createReservation" ? lost : Effect.void
              )
            );
        },
        setReservationStatusIfMatches: (input) => {
          const confirming = input.status === "CONFIRMED";
          if (confirming) confirmations++;
          else cancellations++;
          return provider.service
            .setReservationStatusIfMatches(input)
            .pipe(
              Effect.tap(() =>
                operation ===
                (confirming ? "confirmReservation" : "cancelReservation")
                  ? lost
                  : Effect.void
              )
            );
        },
      });
      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const first = yield* Effect.result(reserve());
          const worker = yield* PassDayMoves;
          yield* worker.reconcile(2);
          yield* worker.reconcile(2);
          const second = yield* reserve();
          return { first, second };
        }).pipe(Effect.provide(layer))
      );
      expect(Result.isFailure(results.first)).toBe(true);
      expect(results.second).toBe(source.id);
      expect([creates, confirmations, cancellations]).toEqual([1, 1, 1]);
      const [audit] = await moves();
      expect(audit.settled_at).toBe("2027-03-27 22:55:00+00");
      expect((await readDay()).dotypos_reservation_id).toBe(
        audit.target_reservation_id
      );
      expect((await getRecord(original.id)).status).toBe("CANCELLED");
    }
  );

  test.each(["server", "timeout"] as const)(
    "a token %s failure releases the destination intent without replacing the source",
    async (reason) => {
      const day = await fixture();
      const layer = day.runtime({
        createReservation: () =>
          new DotyposUnavailable({
            operation: "createReservation",
            reason,
          }),
      });
      await Effect.runPromise(
        Effect.gen(function* () {
          expect(Result.isFailure(yield* Effect.result(day.reserve()))).toBe(
            true
          );
          expect(yield* day.targetHasMoveClaim).toBe(false);
        }).pipe(Effect.provide(layer))
      );
      const [audit] = await day.moves();
      expect(audit.settled_at).not.toBeNull();
      expect(audit.target_reservation_id).toBeNull();
      expect((await day.readDay()).dotypos_reservation_id).toBe(
        day.original.id
      );
      expect((await day.getRecord(day.original.id)).status).toBe("CONFIRMED");
    }
  );

  test("a known target that disappears during cancellation releases its intent on retry", async () => {
    const day = await fixture();
    const layer = day.runtime({
      setReservationStatusIfMatches: (input) =>
        input.status === "CONFIRMED"
          ? TestClock.setTime(afterMidnight.epochMilliseconds).pipe(
              Effect.andThen(
                provider.service.setReservationStatusIfMatches(input)
              )
            )
          : Effect.sync(() =>
              provider.reservations.delete(input.reservationId)
            ).pipe(
              Effect.andThen(
                new DotyposUncertain({
                  operation: "setReservationStatusIfMatches",
                  reason: "timeout",
                })
              )
            ),
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        expect(Result.isFailure(yield* Effect.result(day.reserve()))).toBe(
          true
        );
        expect(yield* day.targetHasMoveClaim).toBe(true);
        const worker = yield* PassDayMoves;
        yield* worker.reconcile(2);
        expect(yield* day.targetHasMoveClaim).toBe(false);
      }).pipe(Effect.provide(layer))
    );
    const [audit] = await day.moves();
    expect(audit.settled_at).not.toBeNull();
    expect(audit.attached_at).toBeNull();
    expect(audit.target_reservation_id).not.toBeNull();
    expect((await day.readDay()).dotypos_reservation_id).toBe(day.original.id);
    expect((await day.getRecord(day.original.id)).status).toBe("CONFIRMED");
  });

  test("withdrawal committed during confirmation wins the attachment fence", async () => {
    const { original, passId, runtime, reserve, moves, getRecord, readDay } =
      await fixture();
    const layer = runtime({
      setReservationStatusIfMatches: (input) =>
        Effect.andThen(
          input.status === "CONFIRMED"
            ? Effect.promise(() =>
                pool.query(
                  "update pass_purchases set status = 'withdrawn', access_ends_on = valid_from where id = $1",
                  [passId]
                )
              )
            : Effect.void,
          provider.service.setReservationStatusIfMatches(input)
        ),
    });
    const result = await Effect.runPromise(
      reserve().pipe(Effect.result, Effect.provide(layer))
    );
    expect(Result.isFailure(result)).toBe(true);
    const [audit] = await moves();
    expect(audit.attached_at).toBeNull();
    expect(audit.settled_at).toBe("2027-03-27 22:55:00+00");
    expect((await readDay()).dotypos_reservation_id).toBe(original.id);
    expect((await getRecord(original.id)).status).toBe("CONFIRMED");
    expect((await getRecord(audit.target_reservation_id)).status).toBe(
      "CANCELLED"
    );
  });

  test("crossing Prague midnight while verifying the source sends no create request", async () => {
    const day = await fixture();
    let attempts = 0;
    const layer = day.runtime({
      getReservationWithoutCustomer: (id) =>
        TestClock.setTime(afterMidnight.epochMilliseconds).pipe(
          Effect.andThen(provider.service.getReservationWithoutCustomer(id))
        ),
      createReservation: (input) => {
        attempts++;
        return provider.service.createReservation(input);
      },
    });
    expect(
      Result.isFailure(
        await Effect.runPromise(
          day.reserve().pipe(Effect.result, Effect.provide(layer))
        )
      )
    ).toBe(true);
    expect(attempts).toBe(0);
    expect((await day.readDay()).dotypos_reservation_id).toBe(day.original.id);
    expect((await day.moves())[0]!.settled_at).not.toBeNull();
  });

  test("crossing Prague midnight during confirmation keeps the original day", async () => {
    const { original, runtime, reserve, moves, readDay, getRecord } =
      await fixture();
    const layer = runtime({
      setReservationStatusIfMatches: (input) =>
        Effect.andThen(
          input.status === "CONFIRMED"
            ? TestClock.setTime(afterMidnight.epochMilliseconds)
            : Effect.void,
          provider.service.setReservationStatusIfMatches(input)
        ),
    });
    expect(
      Result.isFailure(
        await Effect.runPromise(
          reserve().pipe(Effect.result, Effect.provide(layer))
        )
      )
    ).toBe(true);
    const [audit] = await moves();
    expect(audit.attached_at).toBeNull();
    expect((await readDay()).dotypos_reservation_id).toBe(original.id);
    expect((await getRecord(original.id)).status).toBe("CONFIRMED");
    expect((await getRecord(audit.target_reservation_id)).status).toBe(
      "CANCELLED"
    );
  });

  test("crossing Prague midnight while waiting for the attachment row lock keeps the source", async () => {
    const day = await fixture();
    const blocker = await holdPostgresTransaction(
      pool,
      "select id from workspace_reservations where id = $1 for no key update",
      [day.availability.id]
    );
    let committed = false;
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const move = yield* Effect.result(day.reserve()).pipe(
            Effect.forkChild
          );
          yield* Effect.promise(() =>
            waitForPostgresLockWaiter(pool, {
              condition: "$1 = any(pg_blocking_pids(pid))",
              values: [blocker.pid],
              description: "the move to wait for its attachment row lock",
            })
          );
          yield* TestClock.setTime(afterMidnight.epochMilliseconds);
          yield* Effect.promise(async () => {
            await blocker.commit();
            committed = true;
          });
          return yield* Fiber.join(move);
        }).pipe(Effect.provide(day.runtime()))
      );
      expect(Result.isFailure(result)).toBe(true);
      const [audit] = await day.moves();
      expect(audit.attached_at).toBeNull();
      expect((await day.readDay()).dotypos_reservation_id).toBe(
        day.original.id
      );
      expect((await day.getRecord(audit.target_reservation_id)).status).toBe(
        "CANCELLED"
      );
    } finally {
      if (!committed) await blocker.commit();
    }
  });

  test("preserves the source when the provider shows two matching replacements", async () => {
    const { original, target, runtime, reserve, moves, readDay, getRecord } =
      await fixture();
    const layer = runtime({
      createReservation: (input) =>
        provider.service
          .createReservation(input)
          .pipe(Effect.tap(() => provider.service.createReservation(input))),
    });
    expect(
      Result.isFailure(
        await Effect.runPromise(
          reserve().pipe(Effect.result, Effect.provide(layer))
        )
      )
    ).toBe(true);
    const [audit] = await moves();
    expect(audit.ambiguous_at).toBe("2027-03-27 22:55:00+00");
    expect(audit.attached_at).toBeNull();
    expect((await readDay()).dotypos_reservation_id).toBe(original.id);
    expect((await getRecord(original.id)).status).toBe("CONFIRMED");
    expect(
      [...provider.reservations.values()].filter(
        ({ _tableId, status }) => _tableId === target.id && status === "NEW"
      )
    ).toHaveLength(2);
  });

  test("parks a multi-ID create response before reconciliation can discover only one target", async () => {
    const day = await fixture();
    const createdIds: (typeof day.original.id)[] = [];
    const layer = day.runtime({
      createReservation: Effect.fnUntraced(function* (input) {
        const first = yield* provider.service.createReservation(input);
        const second = yield* provider.service.createReservation(input);
        createdIds.push(first.id, second.id);
        provider.reservations.delete(second.id);
        return yield* new DotyposUncertain({
          operation: "createReservation",
          reason: "invalid-response",
          createdReservationIds: [...createdIds],
        });
      }),
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        expect(Result.isFailure(yield* Effect.result(day.reserve()))).toBe(
          true
        );
        const worker = yield* PassDayMoves;
        yield* worker.reconcile(2);
        expect(yield* day.targetHasMoveClaim).toBe(true);
      }).pipe(Effect.provide(layer))
    );
    const [audit] = await day.moves();
    expect(audit.ambiguous_reservation_ids).toEqual(createdIds);
    expect(audit.attached_at).toBeNull();
    expect(audit.settled_at).toBeNull();
    expect((await day.readDay()).dotypos_reservation_id).toBe(day.original.id);
    expect((await day.getRecord(day.original.id)).status).toBe("CONFIRMED");
  });

  test("counts the old source if refreshed provider inventory reports it active", async () => {
    const day = await fixture();
    const layer = day.runtime({
      listActiveReservationsOverlapping: Effect.fnUntraced(
        function* (interval) {
          const old = provider.reservations.get(day.original.id);
          if (old?.status === "CANCELLED") {
            provider.reservations.set(old.id, { ...old, status: "CONFIRMED" });
          }
          return yield* provider.service.listActiveReservationsOverlapping(
            interval
          );
        }
      ),
    });
    expect(
      Result.isFailure(
        await Effect.runPromise(
          day.reserve().pipe(Effect.result, Effect.provide(layer))
        )
      )
    ).toBe(true);
    const [audit] = await day.moves();
    expect(audit.attached_at).not.toBeNull();
    expect((await day.getRecord(day.original.id)).status).toBe("CONFIRMED");
  });

  test("withdrawal never cancels a changed moved hold and releases it after exact ownership is restored", async () => {
    const day = await fixture();
    await Effect.runPromise(day.reserve().pipe(Effect.provide(day.runtime())));
    const [audit] = await day.moves();
    const target = await day.getRecord(audit.target_reservation_id);
    provider.reservations.set(target.id, {
      ...target,
      note: "Different booking marker",
    });
    await pool.query(
      "update pass_purchases set status = 'withdrawn', access_ends_on = valid_from where id = $1",
      [day.passId]
    );
    let unconditionalCancellations = 0;
    const layer = day.runtime({
      cancelReservation: (id) => {
        unconditionalCancellations++;
        return provider.service.cancelReservation(id);
      },
    });
    const release = Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const [purchase] = yield* db
        .select()
        .from(passPurchases)
        .where(eq(passPurchases.id, day.passId));
      yield* releaseUnlimitedPassDays(purchase!);
    }).pipe(WorkspaceLockSections.passPurchaseFulfillment(day.passId));
    await Effect.runPromise(release.pipe(Effect.provide(layer)));
    expect((await day.readDay()).reservation_state).toBe("cancelling");
    expect((await day.getRecord(target.id)).status).toBe("CONFIRMED");

    provider.reservations.set(target.id, target);
    await Effect.runPromise(release.pipe(Effect.provide(layer)));
    expect((await day.readDay()).reservation_state).toBe("cancelled");
    expect((await day.getRecord(target.id)).status).toBe("CANCELLED");
    expect(unconditionalCancellations).toBe(0);
  });

  test("a competing allocation waits for the move and sees the ordinary claim", async () => {
    const { source, target, customerId, runtime, reserve, assign, moves } =
      await fixture();
    const posting = Deferred.makeUnsafe<void>();
    const allow = Deferred.makeUnsafe<void>();
    const layer = runtime({
      createReservation: (input) =>
        input.tableId === target.id
          ? Deferred.succeed(posting, undefined).pipe(
              Effect.andThen(Deferred.await(allow)),
              Effect.andThen(provider.service.createReservation(input))
            )
          : provider.service.createReservation(input),
    });
    const booked = Effect.runPromise(
      Effect.andThen(
        TestClock.setTime(beforeMidnight.epochMilliseconds),
        withWorkspaceReservationCapacity(
          ordinaryInterval,
          assign.pipe(
            Effect.flatMap((tableId) =>
              provider.service.createReservation({
                customerId,
                tableId,
                seats: 1,
                status: "NEW",
                startDate: new Date(ordinaryInterval.startsAt),
                endDate: new Date(ordinaryInterval.endsAt),
              })
            )
          )
        )
      ).pipe(Effect.provide(layer))
    );
    try {
      await Effect.runPromise(
        Deferred.await(posting).pipe(Effect.timeout("5 seconds"))
      );
      const competing = Effect.runPromise(
        reserve().pipe(Effect.result, Effect.provide(layer))
      );
      try {
        await waitForAdvisoryLockWaiter(pool, ["reservation-capacity", date]);
      } finally {
        await Effect.runPromise(Deferred.succeed(allow, undefined));
      }
      expect((await booked)._tableId).toBe(source.id);
      expect(Result.isFailure(await competing)).toBe(true);
      expect(await moves()).toHaveLength(1);
    } finally {
      await Effect.runPromise(Deferred.succeed(allow, undefined));
      await booked;
    }
  });

  test("reconciliation leaves the source in place if a confirmed replacement is no longer held", async () => {
    const { original, runtime, reserve, moves, readDay, getRecord } =
      await fixture();
    const layer = runtime({
      setReservationStatusIfMatches: (input) =>
        input.status === "CONFIRMED"
          ? provider.service.setReservationStatusIfMatches(input)
          : new DotyposUncertain({
              operation: "setReservationStatusIfMatches",
              reason: "timeout",
            }),
    });
    expect(
      Result.isFailure(
        await Effect.runPromise(
          reserve().pipe(Effect.result, Effect.provide(layer))
        )
      )
    ).toBe(true);
    const [audit] = await moves();
    expect(audit.attached_at).toBe("2027-03-27 22:55:00+00");
    expect((await readDay()).dotypos_reservation_id).toBe(
      audit.target_reservation_id
    );
    await Effect.runPromise(
      provider.service.cancelReservation(audit.target_reservation_id)
    );
    await Effect.runPromise(
      Effect.andThen(
        TestClock.setTime(afterMidnight.epochMilliseconds),
        Effect.flatMap(PassDayMoves, (worker) => worker.reconcile(2))
      ).pipe(Effect.provide(runtime()))
    );
    expect((await moves())[0]!.settled_at).toBeNull();
    expect((await getRecord(original.id)).status).toBe("CONFIRMED");
  });
});
