import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type DotyposReservationId,
  DotyposReservationIdSchema,
  type DotyposReservationStatus,
  DotyposService,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { asc, eq, inArray } from "drizzle-orm";
import { Effect, Latch, Layer, Ref, Result, Schema } from "effect";
import { workspaceReservations } from "@/db/schema";
import { customerAgentClientIdSchema } from "@/features/account/backend/auth/customer-agent-authorization.service";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { recordCheckoutAnalytics } from "@/features/checkout/backend/analytics/checkout-analytics.service.mock";
import { payStateDefaultTtlMilliseconds } from "@/features/checkout/backend/checkout";
import { deriveCheckoutAttemptKeys } from "@/features/checkout/backend/checkout/checkout-lookup-keys.server";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/holds";
import { WorkspaceTableAssignmentServiceMock } from "@/features/checkout/backend/reservation/workspace-table-assignment.service.mock";
import {
  type CheckoutAttemptId,
  type CheckoutSessionId,
  checkoutAttemptIdSchema,
  checkoutSessionIdSchema,
  promoteCheckoutAttemptToSessionId,
} from "@/features/checkout/checkout-identifiers";
import { checkoutDetailsSchema } from "@/features/checkout/schemas/checkout-details";
import { reservationOrderIssuanceSchema } from "@/features/reservation/reservation-order";
import { TestSealedStateKeys } from "@/shared/testing/sealed-state-keys.test-utils";
import {
  syntheticDotyposCustomerId,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { agentSelectionKeySchema, type BookingAgent } from "./booking-agent";
import { ReservationHolds } from "./reservation-holds.service";
import {
  WorkspaceAvailabilityService,
  WorkspaceTableUnavailableError,
} from "./workspace-availability.service";
import {
  type IWorkspaceReservationRepository,
  WorkspaceReservationRepository,
} from "./workspace-reservation.repository";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

type HoldRequest = Parameters<
  (typeof ReservationHolds)["Service"]["holdForAttempt"]
>[0];

const reservation = Schema.decodeUnknownSync(
  reservationOrderIssuanceSchema("CZ")
)({
  kind: "cowork",
  entryTier: "open-space",
  date: "2099-06-10",
  coffee: false,
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone: "+420 777 777 777",
  billing: { purpose: "personal", invoice: "none" },
});

/** The same visit with coffee: another selection, so another attempt key. */
const reservationWithCoffee = Schema.decodeUnknownSync(
  reservationOrderIssuanceSchema("CZ")
)({ ...reservation, coffee: true });

const checkoutDetails = Schema.decodeUnknownSync(checkoutDetailsSchema)({
  locale: "en-US",
  reservation: {
    kind: "cowork",
    entryTier: "open-space",
    date: "2099-06-10",
    coffee: false,
  },
  payment: {
    expectedPrice: { value: 29_000, exponent: 2, currency: "CZK" },
    undiscountedPrice: { value: 29_000, exponent: 2, currency: "CZK" },
    discounts: [],
    summary: {
      sections: [],
      total: { value: 29_000, exponent: 2, currency: "CZK" },
    },
  },
  legal: {},
});

const dotyposUnavailable = (operation: string) =>
  new DotyposUnavailable({ operation, reason: "server" });

describe.skipIf(!postgresDatabase)(
  "ReservationHolds.holdForAttempt on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    const authors: CustomerAccountId[] = [];

    afterEach(async () => {
      if (authors.length === 0) return;
      await postgres.db
        .delete(workspaceReservations)
        .where(inArray(workspaceReservations.authorAccountId, authors))
        .pipe(Effect.runPromise);
      authors.length = 0;
    });

    const newAuthor = async () => {
      const author = await workspaceFixtures(postgres.db)
        .customerAccount()
        .pipe(Effect.runPromise);
      authors.push(author);
      return author;
    };

    const newSessionId = () =>
      checkoutSessionIdSchema.make(`session-${crypto.randomUUID()}`);
    const newAttemptId = () =>
      checkoutAttemptIdSchema.make(`attempt-${crypto.randomUUID()}`);

    /**
     * Dotypos behind its service mock: each created hold gets a fresh id,
     * and every hold reads as `NEW` until a test says otherwise.
     */
    const makeDotypos = () => {
      const createdHolds: DotyposReservationId[] = [];
      const createReservation = mock(() =>
        Effect.sync(() => {
          const id = DotyposReservationIdSchema.make(
            `dotypos-hold-${crypto.randomUUID()}`
          );
          createdHolds.push(id);
          return { id } as never;
        })
      );
      const cancelReservation = mock(
        (_id: DotyposReservationId) => Effect.void
      );
      const getReservationStatus = mock((_id: DotyposReservationId) =>
        Effect.succeed<DotyposReservationStatus>("NEW")
      );
      return {
        createdHolds,
        createReservation,
        cancelReservation,
        getReservationStatus,
      };
    };
    type Dotypos = ReturnType<typeof makeDotypos>;

    const makeHolds = (
      options: {
        readonly dotypos?: Dotypos;
        readonly ensureAvailable?: ReturnType<typeof mock>;
        /** Wraps the Postgres repository the module reads and writes. */
        readonly observeReservations?: (
          reservations: IWorkspaceReservationRepository
        ) => IWorkspaceReservationRepository;
      } = {}
    ) => {
      const dotypos = options.dotypos ?? makeDotypos();
      const ensureAvailable =
        options.ensureAvailable ?? mock(() => Effect.void);
      const analytics = recordCheckoutAnalytics();
      const { observeReservations } = options;
      const reservations = WorkspaceReservationRepository.Default.pipe(
        Layer.provide(postgres.layer)
      );
      const enqueueCleanup = mock(
        (_cleanup: {
          readonly orderId: string;
          readonly reservationHoldExpiresAt: Temporal.Instant;
        }) => Effect.void
      );
      const layer = ReservationHolds.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            observeReservations
              ? Layer.effect(
                  WorkspaceReservationRepository,
                  Effect.map(
                    WorkspaceReservationRepository,
                    observeReservations
                  )
                ).pipe(Layer.provide(reservations))
              : reservations,
            Layer.mock(WorkspaceAvailabilityService, {
              ensureAvailable: ensureAvailable as never,
            }),
            Layer.mock(DotyposService, {
              createReservation: dotypos.createReservation as never,
              cancelReservation: dotypos.cancelReservation as never,
              getReservationStatus: dotypos.getReservationStatus as never,
            }),
            WorkspaceTableAssignmentServiceMock({
              assignTableId: () => Effect.succeed("table-id" as never),
            }),
            Layer.mock(ReservationHoldCleanupScheduleService, {
              enqueueCleanup,
            } as never),
            analytics.layer,
            TestSealedStateKeys
          )
        )
      );
      const hold = (request: HoldRequest) =>
        ReservationHolds.pipe(
          Effect.flatMap((holds) => holds.holdForAttempt(request)),
          Effect.provide(layer)
        );
      return {
        dotypos,
        ensureAvailable,
        enqueueCleanup,
        /** The `reservation started` events captured, by reservation id. */
        reservationsStarted: () =>
          analytics.messages
            .filter(({ event }) => event === "reservation started")
            .map(({ distinctId }) => distinctId),
        hold,
        holdForAttempt: (request: HoldRequest) =>
          hold(request).pipe(Effect.runPromise),
        /** The failure `holdForAttempt` ends with. */
        holdFailure: (request: HoldRequest) =>
          hold(request).pipe(Effect.flip, Effect.runPromise),
      };
    };

    /**
     * Holds for two requests of one attempt that race. Both pass the
     * availability check before either drafts, so both resume the same
     * draft, and neither claims its hold creation until both have it. The
     * winner's Dotypos write waits until the loser's claim has failed, and
     * the loser sees the outcome of its claim only once the winner has
     * attached or released the hold, so its first look at the reservation
     * finds it settled.
     */
    const makeRacingHolds = (dotypos = makeDotypos()) => {
      const countdown = (latch: Latch.Latch, ref: Ref.Ref<number>) =>
        Ref.updateAndGet(ref, (count) => count + 1).pipe(
          Effect.flatMap((count) => (count >= 2 ? latch.open : Effect.void))
        );
      const bothChecked = Effect.runSync(Latch.make());
      const checked = Effect.runSync(Ref.make(0));
      const bothDrafted = Effect.runSync(Latch.make());
      const drafted = Effect.runSync(Ref.make(0));
      const bothClaimed = Effect.runSync(Latch.make());
      const claimed = Effect.runSync(Ref.make(0));
      const settled = Effect.runSync(Latch.make());

      const ensureAvailable = mock(() =>
        countdown(bothChecked, checked).pipe(Effect.andThen(bothChecked.await))
      );
      const createHold = dotypos.createReservation.getMockImplementation()!;
      dotypos.createReservation.mockImplementation(() =>
        bothClaimed.await.pipe(Effect.andThen(createHold()))
      );
      return makeHolds({
        dotypos,
        ensureAvailable,
        observeReservations: (reservations) => ({
          ...reservations,
          claimHoldCreation: (id) =>
            countdown(bothDrafted, drafted).pipe(
              Effect.andThen(bothDrafted.await),
              Effect.andThen(reservations.claimHoldCreation(id)),
              Effect.tap(() => countdown(bothClaimed, claimed)),
              Effect.tap((won) => (won ? Effect.void : settled.await))
            ),
          attachHold: (input) =>
            reservations.attachHold(input).pipe(Effect.ensuring(settled.open)),
          releaseHoldCreation: (id) =>
            reservations
              .releaseHoldCreation(id)
              .pipe(Effect.ensuring(settled.open)),
        }),
      });
    };

    /** Runs two requests at once; each outcome as a `Result`. */
    const race = (
      holds: ReturnType<typeof makeHolds>,
      request: HoldRequest,
      rival: HoldRequest = request
    ) =>
      Effect.all(
        [request, rival].map((racing) =>
          holds.hold(racing).pipe(Effect.result)
        ),
        { concurrency: "unbounded" }
      ).pipe(Effect.runPromise);

    const holdRequest = (input: {
      readonly author: CustomerAccountId;
      readonly sessionId?: CheckoutSessionId;
      readonly attemptId?: CheckoutAttemptId;
      readonly customer?: HoldRequest["booking"]["customer"];
      readonly locale?: HoldRequest["booking"]["locale"];
      readonly bookedAt?: Temporal.Instant;
      readonly agent?: BookingAgent["Service"];
      readonly reservation?: HoldRequest["reservation"];
    }): HoldRequest => ({
      checkout: {
        sessionId: input.sessionId ?? newSessionId(),
        attemptId: input.attemptId ?? newAttemptId(),
      },
      reservation: input.reservation ?? reservation,
      booking: {
        author: input.author,
        customer: input.customer ?? syntheticDotyposCustomerId(),
        locale: input.locale ?? "en-US",
        purpose: "personal",
        bookedAt: input.bookedAt ?? Temporal.Now.instant(),
        ...(input.agent && { agent: input.agent }),
      },
      checkoutDetails,
    });

    const rowsOf = (author: CustomerAccountId) =>
      postgres.db
        .select()
        .from(workspaceReservations)
        .where(eq(workspaceReservations.authorAccountId, author))
        .orderBy(asc(workspaceReservations.createdAt))
        .pipe(Effect.runPromise);

    const rowOf = async (id: string) => {
      const [row] = await postgres.db
        .select()
        .from(workspaceReservations)
        .where(eq(workspaceReservations.id, id as never))
        .pipe(Effect.runPromise);
      return row;
    };

    const setPaymentState = (id: string, paymentState: "pending" | "paid") =>
      postgres.pool.query(
        `update workspace_reservations
            set payment_state = $2,
                paid_at = case when $2 = 'paid' then now() end
          where id = $1`,
        [id, paymentState]
      );

    /** The attempt key the module stores for `request`'s attempt. */
    const storedAttemptKey = (request: HoldRequest) =>
      deriveCheckoutAttemptKeys({
        checkoutSessionId: request.checkout.sessionId,
        checkoutAttemptId: request.checkout.attemptId,
        reservation: request.reservation,
      }).pipe(
        Effect.map((keys) => keys.current),
        Effect.provide(TestSealedStateKeys),
        Effect.runSync
      );

    /**
     * Makes the database refuse every reservation update matching the
     * trigger condition `when`, as a failed write would, until `drop` runs.
     */
    const refuseUpdates = async (when: string) => {
      const name = `refuse_update_${crypto.randomUUID().replaceAll("-", "")}`;
      await postgres.pool.query(
        `create function ${name}() returns trigger language plpgsql as $$
         begin
           raise exception 'reservation update refused by the test';
         end;
         $$`
      );
      await postgres.pool.query(
        `create trigger ${name}
           before update on workspace_reservations
           for each row
           when (${when})
           execute function ${name}()`
      );
      return {
        drop: async () => {
          await postgres.pool.query(
            `drop trigger ${name} on workspace_reservations`
          );
          await postgres.pool.query(`drop function ${name}()`);
        },
      };
    };

    /**
     * Makes the database refuse to attach the Dotypos hold `dotyposId` to
     * its reservation until `drop` runs.
     */
    const refuseAttaching = (dotyposId: DotyposReservationId) =>
      refuseUpdates(
        `new.reservation_state = 'held'
           and new.dotypos_reservation_id = '${dotyposId}'`
      );

    describe("for the site and native apps", () => {
      test("creates one held reservation with its Dotypos hold for a first attempt", async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const request = holdRequest({ author });
        const before = Temporal.Now.instant();

        const hold = await holds.holdForAttempt(request);
        const after = Temporal.Now.instant();

        const rows = await rowsOf(author);
        expect(rows).toHaveLength(1);
        const [row] = rows;
        expect(hold).toEqual({
          kind: "created",
          reservationId: row!.id,
          checkoutSessionId: request.checkout.sessionId,
        });
        expect(row?.reservationState).toBe("held");
        expect(row?.paymentState).toBe("not_started");
        expect(row?.dotyposCustomerId).toBe(request.booking.customer);
        expect(row?.checkoutAttemptKey).toBe(storedAttemptKey(request));
        expect(holds.ensureAvailable.mock.calls).toEqual([
          [
            {
              kind: "cowork",
              date: "2099-06-10",
              entryTier: "open-space",
              monitorOption: undefined,
            },
          ],
        ]);
        expect(holds.dotypos.createReservation).toHaveBeenCalledTimes(1);
        expect(holds.dotypos.createReservation.mock.calls[0]).toEqual([
          expect.objectContaining({
            customerId: request.booking.customer,
            status: "NEW",
          }),
        ]);
        expect(row?.dotyposReservationId).toBe(holds.dotypos.createdHolds[0]!);
        // A site hold lasts one Pay-state lifetime from when it's created.
        const expiresAt = row!.reservationHoldExpiresAt!.epochMilliseconds;
        expect(expiresAt).toBeGreaterThanOrEqual(
          before.epochMilliseconds + payStateDefaultTtlMilliseconds
        );
        expect(expiresAt).toBeLessThanOrEqual(
          after.epochMilliseconds + payStateDefaultTtlMilliseconds
        );
        expect(holds.enqueueCleanup).toHaveBeenCalledTimes(1);
        const [cleanup] = holds.enqueueCleanup.mock.calls[0]!;
        expect(cleanup.orderId).toBe(row!.id);
        // Postgres keeps microseconds; the cleanup gets the instant as made.
        expect(cleanup.reservationHoldExpiresAt.epochMilliseconds).toBe(
          expiresAt
        );
      });

      test("reuses the attempt's hold for an immediate retry and refreshes its details", async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const request = holdRequest({ author });
        const created = await holds.holdForAttempt(request);

        const retry = await holds.holdForAttempt({
          ...request,
          booking: { ...request.booking, locale: "cs-CZ" },
        });

        const rows = await rowsOf(author);
        expect(rows).toHaveLength(1);
        expect(created.kind).toBe("created");
        expect(retry).toMatchObject({
          kind: "reused",
          reservation: { id: rows[0]!.id },
          checkoutSessionId: request.checkout.sessionId,
        });
        expect(retry).not.toHaveProperty("pricedFor");
        expect(rows[0]?.locale).toBe("cs-CZ");
        expect(holds.dotypos.createReservation).toHaveBeenCalledTimes(1);
        // The retry schedules no second cleanup for the same hold.
        expect(holds.enqueueCleanup).toHaveBeenCalledTimes(1);
      });

      test("creates one Dotypos hold when identical requests race for an attempt", async () => {
        const author = await newAuthor();
        const request = holdRequest({ author });
        const holds = makeRacingHolds();

        const outcomes = await race(holds, request);

        const rows = await rowsOf(author);
        expect(holds.dotypos.createReservation).toHaveBeenCalledTimes(1);
        expect(rows).toHaveLength(1);
        const results = outcomes.map(Result.getOrThrow);
        expect(rows[0]?.reservationState).toBe("held");
        expect(results.map(({ kind }) => kind).sort()).toEqual([
          "created",
          "reused",
        ]);
        // The request that lost the claim prices the hold for the
        // customer the winner created it for.
        expect(results.find(({ kind }) => kind === "reused")).toMatchObject({
          reservation: { id: rows[0]!.id },
          pricedFor: request.booking.customer,
        });
      });

      // The booking re-quotes the hold for `pricedFor` only after this, so a
      // failed re-quote leaves the refreshed details and the captured start.
      test("refreshes the details and captures the start of the hold it reuses after losing the claim", async () => {
        const author = await newAuthor();
        const request = holdRequest({ author });
        const rival = {
          ...request,
          booking: { ...request.booking, locale: "cs-CZ" as const },
        };
        const holds = makeRacingHolds();

        const outcomes = await race(holds, request, rival);

        const results = outcomes.map(Result.getOrThrow);
        const loser = results.findIndex(({ kind }) => kind === "reused");
        expect(results[loser]).toHaveProperty(
          "pricedFor",
          request.booking.customer
        );
        const [row] = await rowsOf(author);
        expect(row?.locale).toBe([request, rival][loser]?.booking.locale);
        expect(holds.reservationsStarted()).toEqual([row!.id, row!.id]);
      });

      test("fails without capturing a start when refreshing the hold it reuses after losing the claim fails", async () => {
        const author = await newAuthor();
        const request = holdRequest({ author });
        const holds = makeRacingHolds();
        // Only a reused hold's details refresh updates a held row.
        const refusal = await refuseUpdates(
          `old.author_account_id = '${author}'
             and old.reservation_state = 'held'
             and new.reservation_state = 'held'`
        );

        let outcomes: Awaited<ReturnType<typeof race>>;
        try {
          outcomes = await race(holds, request);
        } finally {
          await refusal.drop();
        }

        const [row] = await rowsOf(author);
        expect(row?.reservationState).toBe("held");
        expect(
          outcomes.map((outcome) =>
            Result.isSuccess(outcome) ? outcome.success : outcome.failure
          )
        ).toEqual(
          expect.arrayContaining([
            {
              kind: "created",
              reservationId: row!.id,
              checkoutSessionId: request.checkout.sessionId,
            },
            expect.objectContaining({
              _tag: expect.stringMatching(/QueryError/),
            }),
          ])
        );
        expect(holds.dotypos.createReservation).toHaveBeenCalledTimes(1);
        expect(holds.dotypos.cancelReservation).not.toHaveBeenCalled();
        // Only the winner's start; the loser stopped at the refresh.
        expect(holds.reservationsStarted()).toEqual([row!.id]);
      });

      test("returns the draft with its claim released when Dotypos fails to create the hold", async () => {
        const author = await newAuthor();
        const dotypos = makeDotypos();
        const creationFailure = dotyposUnavailable("createReservation");
        dotypos.createReservation.mockImplementationOnce(
          () => Effect.fail(creationFailure) as never
        );
        const holds = makeHolds({ dotypos });
        const request = holdRequest({ author });

        const failure = await holds.holdFailure(request);

        expect(failure).toBe(creationFailure);
        const [draft] = await rowsOf(author);
        expect(draft?.reservationState).toBe("draft");
        expect(draft?.dotyposReservationId).toBeNull();
        expect(dotypos.cancelReservation).not.toHaveBeenCalled();
        expect(holds.enqueueCleanup).not.toHaveBeenCalled();

        // The released claim lets the next try hold the same draft.
        const retry = await holds.holdForAttempt(request);
        const rows = await rowsOf(author);
        expect(rows).toHaveLength(1);
        expect(retry).toMatchObject({
          kind: "created",
          reservationId: draft!.id,
        });
        expect(rows[0]?.reservationState).toBe("held");
        expect(dotypos.createReservation).toHaveBeenCalledTimes(2);
      });

      test("cancels the Dotypos hold and releases the claim when attaching it fails", async () => {
        const author = await newAuthor();
        const dotyposId = DotyposReservationIdSchema.make(
          `dotypos-hold-${crypto.randomUUID()}`
        );
        const dotypos = makeDotypos();
        dotypos.createReservation.mockImplementationOnce(() =>
          Effect.succeed({ id: dotyposId } as never)
        );
        const holds = makeHolds({ dotypos });
        const refusal = await refuseAttaching(dotyposId);

        try {
          const failure = await holds.holdFailure(holdRequest({ author }));

          expect(failure).toMatchObject({
            _tag: expect.stringMatching(/QueryError/),
          });
        } finally {
          await refusal.drop();
        }
        const rows = await rowsOf(author);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.reservationState).toBe("draft");
        expect(rows[0]?.dotyposReservationId).toBeNull();
        expect(dotypos.cancelReservation.mock.calls).toEqual([[dotyposId]]);
        expect(holds.enqueueCleanup).not.toHaveBeenCalled();
      });

      test("marks the hold for cancellation when attaching it and cancelling it both fail", async () => {
        const author = await newAuthor();
        const dotyposId = DotyposReservationIdSchema.make(
          `dotypos-hold-${crypto.randomUUID()}`
        );
        const cancellationFailure = dotyposUnavailable("cancelReservation");
        const dotypos = makeDotypos();
        dotypos.createReservation.mockImplementationOnce(() =>
          Effect.succeed({ id: dotyposId } as never)
        );
        dotypos.cancelReservation.mockImplementationOnce(
          () => Effect.fail(cancellationFailure) as never
        );
        const holds = makeHolds({ dotypos });
        const refusal = await refuseAttaching(dotyposId);

        try {
          const failure = await holds.holdFailure(holdRequest({ author }));

          expect(failure).toBe(cancellationFailure);
        } finally {
          await refusal.drop();
        }
        const rows = await rowsOf(author);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          reservationState: "cancellation_failed",
          failureCode: "attach_failed_cancel_failed",
          dotyposReservationId: dotyposId,
        });
        expect(rows[0]?.reservationCreatedAt).not.toBeNull();
        expect(dotypos.cancelReservation.mock.calls).toEqual([[dotyposId]]);
      });

      test("refuses an attempt whose hold creation stays in flight", async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const request = holdRequest({ author });
        await workspaceFixtures(postgres.db)
          .reservation({
            stage: { reservation: "creating_hold" },
            author,
            customer: request.booking.customer,
            overrides: { checkoutAttemptKey: storedAttemptKey(request) },
          })
          .pipe(Effect.runPromise);

        const failure = await holds
          .hold(request)
          .pipe(Effect.flip, withInstantSleeps, Effect.runPromise);

        expect(failure._tag).toBe("CheckoutAttemptUnavailableError");
        expect(holds.dotypos.createReservation).not.toHaveBeenCalled();
        const rows = await rowsOf(author);
        expect(rows.map((row) => row.reservationState)).toEqual([
          "creating_hold",
        ]);
      });

      test.each([
        ["hold", "held"],
        ["draft", "draft"],
      ] as const)(
        "refuses to resume an attempt whose %s another account authored",
        async (_label, state) => {
          const holder = await newAuthor();
          const other = await newAuthor();
          const dotypos = makeDotypos();
          if (state === "draft") {
            // A failed hold creation leaves the holder's attempt a draft.
            dotypos.createReservation.mockImplementationOnce(
              () =>
                Effect.fail(dotyposUnavailable("createReservation")) as never
            );
          }
          const holds = makeHolds({ dotypos });
          const request = holdRequest({ author: holder });
          await holds.hold(request).pipe(Effect.result, Effect.runPromise);

          const failure = await holds.holdFailure({
            ...request,
            booking: { ...request.booking, author: other },
          });

          expect(failure._tag).toBe("CheckoutAttemptUnavailableError");
          expect(dotypos.createReservation).toHaveBeenCalledTimes(1);
          expect(await rowsOf(other)).toEqual([]);
          expect((await rowsOf(holder))[0]?.reservationState).toBe(state);
        }
      );

      test("reports the conflict when the request holding the claim leaves no usable hold", async () => {
        const author = await newAuthor();
        const request = holdRequest({ author });
        const creationFailure = dotyposUnavailable("createReservation");
        const dotypos = makeDotypos();
        dotypos.createReservation.mockImplementation(
          () => Effect.fail(creationFailure) as never
        );
        const holds = makeRacingHolds(dotypos);

        const outcomes = await race(holds, request);

        expect(dotypos.createReservation).toHaveBeenCalledTimes(1);
        expect(
          outcomes.map((outcome) =>
            Result.isSuccess(outcome) ? outcome.success : outcome.failure
          )
        ).toEqual(
          expect.arrayContaining([{ kind: "contended" }, creationFailure])
        );
        const rows = await rowsOf(author);
        expect(rows.map((row) => row.reservationState)).toEqual(["draft"]);
      });

      test("moves an attempt whose reservation ended into the attempt's own session", async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const request = holdRequest({ author });
        await holds.holdForAttempt(request);
        const [ended] = await rowsOf(author);
        await postgres.pool.query(
          `update workspace_reservations
              set reservation_state = 'cancelled', reservation_cancelled_at = now()
            where id = $1`,
          [ended!.id]
        );

        const hold = await holds.holdForAttempt(request);

        const replacement = (await rowsOf(author)).find(
          (row) => row.id !== ended!.id
        );
        expect(hold).toEqual({
          kind: "created",
          reservationId: replacement!.id,
          checkoutSessionId: promoteCheckoutAttemptToSessionId(
            request.checkout.attemptId
          ),
        });
        expect(replacement?.checkoutSessionKey).not.toBe(
          ended!.checkoutSessionKey
        );
        expect(holds.dotypos.createReservation).toHaveBeenCalledTimes(2);
      });

      test("refuses an attempt whose unpaid hold lapsed", async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const request = holdRequest({ author });
        await holds.holdForAttempt(request);
        const [lapsed] = await rowsOf(author);
        await postgres.pool.query(
          `update workspace_reservations
              set reservation_hold_expires_at = now() - interval '1 minute'
            where id = $1`,
          [lapsed!.id]
        );

        const failure = await holds.holdFailure(request);

        expect(failure._tag).toBe("CheckoutAttemptUnavailableError");
        expect(await rowsOf(author)).toHaveLength(1);
        expect(holds.dotypos.createReservation).toHaveBeenCalledTimes(1);
        expect(holds.dotypos.cancelReservation).not.toHaveBeenCalled();
      });

      test("refuses a session whose current draft stays unsettled", async () => {
        const author = await newAuthor();
        const dotypos = makeDotypos();
        dotypos.createReservation.mockImplementationOnce(
          () => Effect.fail(dotyposUnavailable("createReservation")) as never
        );
        const holds = makeHolds({ dotypos });
        const sessionId = newSessionId();
        // A failed hold creation leaves the session's current reservation a draft.
        await holds.holdFailure(holdRequest({ author, sessionId }));

        const failure = await holds
          .hold(holdRequest({ author, sessionId }))
          .pipe(Effect.flip, withInstantSleeps, Effect.runPromise);

        expect(failure._tag).toBe("CheckoutAttemptUnavailableError");
        expect(dotypos.createReservation).toHaveBeenCalledTimes(1);
        const rows = await rowsOf(author);
        expect(rows.map((row) => row.reservationState)).toEqual(["draft"]);
      });

      test("drafts nothing for an unavailable selection", async () => {
        const author = await newAuthor();
        const unavailable = new WorkspaceTableUnavailableError({
          date: "2099-06-10",
          reservation: { kind: "cowork", entryTier: "open-space" } as never,
        });
        const holds = makeHolds({
          ensureAvailable: mock(() => Effect.fail(unavailable)),
        });

        const failure = await holds.holdFailure(holdRequest({ author }));

        expect(failure).toBe(unavailable);
        expect(await rowsOf(author)).toEqual([]);
        expect(holds.dotypos.createReservation).not.toHaveBeenCalled();
      });
    });

    describe("in a session that already holds a reservation", () => {
      const holdInSession = async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const sessionId = newSessionId();
        const customer = syntheticDotyposCustomerId();
        const first = holdRequest({ author, sessionId, customer });
        await holds.holdForAttempt(first);
        const [previous] = await rowsOf(author);
        const next = holdRequest({ author, sessionId, customer });
        return { author, holds, sessionId, previous: previous!, next };
      };

      test("cancels the previous hold in Dotypos and holds the new attempt in the same session", async () => {
        const { author, holds, sessionId, previous, next } =
          await holdInSession();

        const hold = await holds.holdForAttempt(next);

        const rows = await rowsOf(author);
        const replacement = rows.find((row) => row.id !== previous.id);
        expect(hold).toEqual({
          kind: "created",
          reservationId: replacement!.id,
          checkoutSessionId: sessionId,
        });
        expect(holds.dotypos.getReservationStatus.mock.calls).toEqual([
          [previous.dotyposReservationId!],
        ]);
        expect(holds.dotypos.cancelReservation.mock.calls).toEqual([
          [previous.dotyposReservationId!],
        ]);
        expect(await rowOf(previous.id)).toMatchObject({
          reservationState: "cancelled",
          reservationCancelledAt: expect.anything(),
        });
        expect(replacement).toMatchObject({
          reservationState: "held",
          checkoutSessionKey: previous.checkoutSessionKey,
        });
        expect(holds.dotypos.createReservation).toHaveBeenCalledTimes(2);
        // The replacement checks availability again once the previous hold
        // is cancelled.
        expect(holds.ensureAvailable).toHaveBeenCalledTimes(2);
      });

      test("cancels the claimed previous hold locally when the new selection is unavailable", async () => {
        const { author, holds, previous, next } = await holdInSession();
        const unavailable = new WorkspaceTableUnavailableError({
          date: "2099-06-10",
          reservation: { kind: "cowork", entryTier: "open-space" } as never,
        });
        holds.ensureAvailable.mockImplementationOnce(() =>
          Effect.fail(unavailable)
        );

        const failure = await holds.holdFailure(next);

        expect(failure).toBe(unavailable);
        expect(holds.dotypos.cancelReservation.mock.calls).toEqual([
          [previous.dotyposReservationId!],
        ]);
        const rows = await rowsOf(author);
        expect(rows.map((row) => [row.id, row.reservationState])).toEqual([
          [previous.id, "cancelled"],
        ]);
      });

      test("moves into the attempt's own session instead of cancelling a hold whose payment started", async () => {
        const { author, holds, previous, next } = await holdInSession();
        await setPaymentState(previous.id, "pending");

        const hold = await holds.holdForAttempt(next);

        const replacement = (await rowsOf(author)).find(
          (row) => row.id !== previous.id
        );
        expect(hold).toMatchObject({
          kind: "created",
          reservationId: replacement!.id,
          checkoutSessionId: promoteCheckoutAttemptToSessionId(
            next.checkout.attemptId
          ),
        });
        expect(replacement?.checkoutSessionKey).not.toBe(
          previous.checkoutSessionKey
        );
        expect(await rowOf(previous.id)).toMatchObject({
          reservationState: "held",
          paymentState: "pending",
        });
        expect(holds.dotypos.getReservationStatus).not.toHaveBeenCalled();
        expect(holds.dotypos.cancelReservation).not.toHaveBeenCalled();
      });

      test("moves into the attempt's own session when Dotypos no longer keeps the previous hold pending", async () => {
        const { author, holds, previous, next } = await holdInSession();
        holds.dotypos.getReservationStatus.mockImplementationOnce(() =>
          Effect.succeed<DotyposReservationStatus>("CONFIRMED")
        );

        const hold = await holds.holdForAttempt(next);

        expect(hold).toMatchObject({
          kind: "created",
          checkoutSessionId: promoteCheckoutAttemptToSessionId(
            next.checkout.attemptId
          ),
        });
        expect(holds.dotypos.cancelReservation).not.toHaveBeenCalled();
        expect(await rowOf(previous.id)).toMatchObject({
          reservationState: "cancellation_failed",
          failureCode: "checkout_supersession_cancel_failed",
        });
        expect(await rowsOf(author)).toHaveLength(2);
      });

      test("moves into the attempt's own session when cancelling the previous hold fails", async () => {
        const { author, holds, previous, next } = await holdInSession();
        holds.dotypos.cancelReservation.mockImplementationOnce(
          () => Effect.fail(dotyposUnavailable("cancelReservation")) as never
        );

        const hold = await holds.holdForAttempt(next);

        expect(hold).toMatchObject({
          kind: "created",
          checkoutSessionId: promoteCheckoutAttemptToSessionId(
            next.checkout.attemptId
          ),
        });
        expect(await rowOf(previous.id)).toMatchObject({
          reservationState: "cancellation_failed",
          failureCode: "checkout_supersession_cancel_failed",
        });
        expect(await rowsOf(author)).toHaveLength(2);
      });

      test("moves into the attempt's own session instead of superseding another account's hold", async () => {
        const { holds, sessionId, previous } = await holdInSession();
        const other = await newAuthor();

        const hold = await holds.holdForAttempt(
          holdRequest({ author: other, sessionId })
        );

        const [otherHold] = await rowsOf(other);
        expect(hold).toMatchObject({
          kind: "created",
          reservationId: otherHold!.id,
        });
        expect(hold).not.toMatchObject({ checkoutSessionId: sessionId });
        expect(otherHold?.checkoutSessionKey).not.toBe(
          previous.checkoutSessionKey
        );
        expect(await rowOf(previous.id)).toMatchObject({
          reservationState: "held",
        });
        expect(holds.dotypos.cancelReservation).not.toHaveBeenCalled();
      });

      test("supersedes the hold it left in the attempt's own session after moving there", async () => {
        const { author, holds, sessionId, previous } = await holdInSession();
        await setPaymentState(previous.id, "pending");
        const attemptId = newAttemptId();
        const ownSessionId = promoteCheckoutAttemptToSessionId(attemptId);
        const customer =
          previous.dotyposCustomerId as HoldRequest["booking"]["customer"];
        await holds.holdForAttempt(
          holdRequest({ author, sessionId, attemptId, customer })
        );
        const [rotated] = (await rowsOf(author)).filter(
          (row) => row.id !== previous.id
        );

        // The same attempt with another selection is a new attempt key in
        // the same own session, whose hold it supersedes.
        const hold = await holds.holdForAttempt(
          holdRequest({
            author,
            sessionId,
            attemptId,
            customer,
            reservation: reservationWithCoffee,
          })
        );

        const replacement = (await rowsOf(author)).find(
          (row) => row.id !== previous.id && row.id !== rotated!.id
        );
        expect(hold).toEqual({
          kind: "created",
          reservationId: replacement!.id,
          checkoutSessionId: ownSessionId,
        });
        expect(replacement?.checkoutSessionKey).toBe(
          rotated!.checkoutSessionKey
        );
        expect(await rowOf(rotated!.id)).toMatchObject({
          reservationState: "cancelled",
        });
        expect(holds.dotypos.cancelReservation.mock.calls).toEqual([
          [rotated!.dotyposReservationId!],
        ]);
        expect(await rowOf(previous.id)).toMatchObject({
          reservationState: "held",
          paymentState: "pending",
        });
      });

      test("refuses an attempt whose reservation ended in its own session", async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const attemptId = newAttemptId();
        const request = holdRequest({
          author,
          attemptId,
          sessionId: promoteCheckoutAttemptToSessionId(attemptId),
        });
        await holds.holdForAttempt(request);
        const [held] = await rowsOf(author);
        await postgres.pool.query(
          `update workspace_reservations
              set reservation_state = 'cancelled', reservation_cancelled_at = now()
            where id = $1`,
          [held!.id]
        );

        const failure = await holds.holdFailure(request);

        expect(failure._tag).toBe("CheckoutAttemptUnavailableError");
        expect(await rowsOf(author)).toHaveLength(1);
        expect(holds.dotypos.createReservation).toHaveBeenCalledTimes(1);
      });
    });

    describe("for a customer agent", () => {
      const agentOf = (clientId: string, selection: string) => ({
        clientId: customerAgentClientIdSchema.make(clientId),
        selectionKey: agentSelectionKeySchema.make(
          `${selection}-${crypto.randomUUID()}`
        ),
      });

      test("reuses the hold of an identical repeat, anchored at its booking instant", async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const agent = agentOf("https://agent.example/client", "selection");
        const sessionId = newSessionId();
        // Whole milliseconds, which Postgres stores exactly.
        const bookedAt = Temporal.Instant.fromEpochMilliseconds(Date.now());
        const first = holdRequest({ author, sessionId, agent, bookedAt });

        const created = await holds.holdForAttempt(first);
        const repeat = await holds.holdForAttempt(
          holdRequest({
            author,
            sessionId,
            agent,
            customer: first.booking.customer,
          })
        );

        const rows = await rowsOf(author);
        expect(rows).toHaveLength(1);
        expect(created).toMatchObject({
          kind: "created",
          reservationId: rows[0]!.id,
        });
        expect(repeat).toMatchObject({
          kind: "reused",
          reservation: { id: rows[0]!.id },
          checkoutSessionId: sessionId,
        });
        expect(rows[0]).toMatchObject({
          agentClientId: agent.clientId,
          agentSelectionKey: agent.selectionKey,
        });
        // An agent hold lasts one Pay-state lifetime from its booking instant.
        expect(rows[0]?.reservationHoldExpiresAt).toEqual(
          bookedAt.add({ milliseconds: payStateDefaultTtlMilliseconds })
        );
        expect(holds.dotypos.createReservation).toHaveBeenCalledTimes(1);
      });

      test("keeps a repeat's reservation whose payment is pending", async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const agent = agentOf("https://agent.example/client", "selection");
        const sessionId = newSessionId();
        const first = holdRequest({ author, sessionId, agent });
        await holds.holdForAttempt(first);
        const [held] = await rowsOf(author);
        await setPaymentState(held!.id, "pending");

        const repeat = await holds.holdForAttempt(
          holdRequest({
            author,
            sessionId,
            agent,
            customer: first.booking.customer,
          })
        );

        expect(repeat).toMatchObject({
          kind: "payment_pending",
          reservation: { id: held!.id },
          checkoutSessionId: sessionId,
        });
        expect(await rowsOf(author)).toHaveLength(1);
        expect(holds.dotypos.createReservation).toHaveBeenCalledTimes(1);
        expect(holds.dotypos.cancelReservation).not.toHaveBeenCalled();
      });

      test("cancels only the same client's hold in a rotated session before holding a new selection", async () => {
        const author = await newAuthor();
        const otherAuthor = await newAuthor();
        const holds = makeHolds();
        const clientId = "https://agent.example/client";
        const sessionId = newSessionId();
        const customer = syntheticDotyposCustomerId();
        const book = (request: HoldRequest) => holds.holdForAttempt(request);
        const idOf = (hold: Awaited<ReturnType<typeof book>>) =>
          hold.kind === "created" ? hold.reservationId : undefined;

        // The agent session holds a paid booking, so the client's next
        // selection is held in a rotated session.
        const paid = idOf(
          await book(
            holdRequest({
              author,
              sessionId,
              customer,
              agent: agentOf(clientId, "paid"),
            })
          )
        );
        await setPaymentState(paid!, "paid");
        const rotated = await book(
          holdRequest({
            author,
            sessionId,
            customer,
            agent: agentOf(clientId, "rotated"),
          })
        );
        expect(rotated.kind).toBe("created");
        expect(rotated).not.toMatchObject({ checkoutSessionId: sessionId });
        // Holds the new selection must leave alone: another client's, and
        // the same client's for another account.
        const otherClients = idOf(
          await book(
            holdRequest({
              author,
              customer,
              agent: agentOf("https://other-agent.example/client", "other"),
            })
          )
        );
        const otherAccounts = idOf(
          await book(
            holdRequest({
              author: otherAuthor,
              agent: agentOf(clientId, "other-account"),
            })
          )
        );
        const rotatedRow = await rowOf(idOf(rotated)!);
        holds.dotypos.cancelReservation.mockClear();

        const next = await book(
          holdRequest({
            author,
            sessionId,
            customer,
            agent: agentOf(clientId, "next"),
          })
        );

        expect(next.kind).toBe("created");
        expect(holds.dotypos.cancelReservation.mock.calls).toEqual([
          [rotatedRow!.dotyposReservationId!],
        ]);
        expect(await rowOf(idOf(rotated)!)).toMatchObject({
          reservationState: "cancelled",
        });
        for (const kept of [otherClients, otherAccounts]) {
          expect(await rowOf(kept!)).toMatchObject({
            reservationState: "held",
          });
        }
        expect(await rowOf(paid!)).toMatchObject({
          reservationState: "held",
          paymentState: "paid",
        });
      });
      test("supersedes the client's previous selection in its session", async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const clientId = "https://agent.example/client";
        const sessionId = newSessionId();
        const customer = syntheticDotyposCustomerId();
        await holds.holdForAttempt(
          holdRequest({
            author,
            sessionId,
            customer,
            agent: agentOf(clientId, "previous"),
          })
        );
        const [previous] = await rowsOf(author);

        const hold = await holds.holdForAttempt(
          holdRequest({
            author,
            sessionId,
            customer,
            agent: agentOf(clientId, "next"),
          })
        );

        const replacement = (await rowsOf(author)).find(
          (row) => row.id !== previous!.id
        );
        expect(hold).toEqual({
          kind: "created",
          reservationId: replacement!.id,
          checkoutSessionId: sessionId,
        });
        expect(replacement?.checkoutSessionKey).toBe(
          previous!.checkoutSessionKey
        );
        expect(await rowOf(previous!.id)).toMatchObject({
          reservationState: "cancelled",
        });
        expect(holds.dotypos.cancelReservation.mock.calls).toEqual([
          [previous!.dotyposReservationId!],
        ]);
      });

      test("holds a new selection when cancelling the client's rotated hold fails", async () => {
        const author = await newAuthor();
        const holds = makeHolds();
        const clientId = "https://agent.example/client";
        const sessionId = newSessionId();
        const customer = syntheticDotyposCustomerId();
        const book = (selection: string) =>
          holds.holdForAttempt(
            holdRequest({
              author,
              sessionId,
              customer,
              agent: agentOf(clientId, selection),
            })
          );
        const paid = await book("paid");
        await setPaymentState(
          paid.kind === "created" ? paid.reservationId : "",
          "paid"
        );
        const rotated = await book("rotated");
        holds.dotypos.cancelReservation.mockImplementationOnce(
          () => Effect.fail(dotyposUnavailable("cancelReservation")) as never
        );

        const next = await book("next");

        expect(next.kind).toBe("created");
        expect(
          await rowOf(rotated.kind === "created" ? rotated.reservationId : "")
        ).toMatchObject({
          reservationState: "cancellation_failed",
          failureCode: "checkout_supersession_cancel_failed",
        });
        expect(await rowsOf(author)).toHaveLength(3);
      });
    });
  }
);
