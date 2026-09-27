import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import type { Pool } from "pg";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { workspaceReservations } from "@/db/schema";
import { ensureReservationOrder } from "@/features/order/backend/reservation-order";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";

/**
 * Mixed-version acceptance gate for the reservation-only order bridge
 * (migration 20260926154904_loud_genesis).
 *
 * The gate spawns a disposable local Postgres (initdb/pg_ctl), applies the
 * full migration chain in stages, writes old-writer-shaped rows on both sides
 * of the bridge migration, then runs the new code paths against that data and
 * proves repair, idempotency, and state preservation. It tears the cluster
 * down afterwards and is safe to rerun.
 */

const migrationsFolder = join(import.meta.dir, "../../../db/migrations");
const bridgeTag = "20260926154904_loud_genesis";

const eqId = (id: WorkspaceReservationId) => eq(workspaceReservations.id, id);

const pgBinCandidates = [
  process.env.RESERVATION_ORDER_GATE_PG_BIN,
  "/usr/lib/postgresql/18/bin",
  "/usr/lib/postgresql/17/bin",
  "/usr/lib/postgresql/16/bin",
  "/usr/local/pgsql/bin",
].filter((candidate): candidate is string => Boolean(candidate));

const pgBin = pgBinCandidates.find(
  (candidate) =>
    existsSync(join(candidate, "initdb")) &&
    existsSync(join(candidate, "pg_ctl"))
);

// This repository has no meta journal: migrations are discovered by their
// timestamp-prefixed directory names, exactly like drizzle's reader.
const allTags = readdirSync(migrationsFolder)
  .filter((name) => existsSync(join(migrationsFolder, name, "migration.sql")))
  .sort();

const run = async (
  file: string,
  args: readonly string[],
  env: Record<string, string> = {}
): Promise<void> => {
  const proc = Bun.spawn([join(pgBin!, file), ...args], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(
      `${file} ${args.join(" ")} failed (${code}): ${await new Response(
        proc.stderr
      ).text()}`
    );
  }
};

describe.skipIf(!pgBin)(
  "reservation order bridge mixed-version gate on a disposable Postgres",
  () => {
    let workdir: string;
    let dataDir: string;
    let port: number;
    let pool: Pool;
    let db: WorkspaceDatabaseClient;
    const baseUrl = () =>
      `postgres://workspace@127.0.0.1:${port}/gate?host=${encodeURIComponent(
        join(workdir, "socket")
      )}`;

    const applyMigrations = async (tags: readonly string[]) => {
      for (const tag of tags) {
        const sql = readFileSync(
          join(migrationsFolder, tag, "migration.sql"),
          "utf8"
        );
        for (const statement of sql.split("--> statement-breakpoint")) {
          if (statement.trim().length === 0) continue;
          await pool.query(statement);
        }
      }
    };

    const oldWriterReservation = async (input: {
      readonly paymentState: string;
      readonly fulfilled: boolean;
    }) => {
      const id = workspaceReservationIdSchema.make(crypto.randomUUID());
      await pool.query(
        `insert into workspace_reservations
           (id, checkout_attempt_key, dotypos_customer_id, dotypos_reservation_id,
            reservation_state, payment_state, fulfillment_state, reservation_details,
            locale, reservation_hold_expires_at, paid_at, fulfilled_at)
         values ($1, $2, $3, $4, 'held', $5, $6, $7, 'en-US', '2099-01-01', $8, $9)`,
        [
          id,
          `attempt-${crypto.randomUUID()}`,
          `customer-${crypto.randomUUID()}`,
          `dotypos-reservation-${crypto.randomUUID()}`,
          input.paymentState,
          input.fulfilled ? "fulfilled" : "not_started",
          JSON.stringify({ kind: "cowork", entryTier: "basic", coffee: false }),
          input.paymentState === "paid" ? new Date().toISOString() : null,
          input.fulfilled ? new Date().toISOString() : null,
        ]
      );
      const { rows: attemptRows } = await pool.query(
        `insert into payment_attempts
           (workspace_reservation_id, provider, provider_order_id, state,
            amount_value, amount_exponent, currency, failure_code)
         values ($1, 'nexi', $2, $3, 35000, 2, 'CZK', $4)
         returning id`,
        [
          id,
          `order-${crypto.randomUUID()}`,
          input.paymentState === "failed" ? "failed" : "created",
          input.paymentState === "failed" ? "provider_declined" : null,
        ]
      );
      // Old writers linked the active attempt on the reservation row.
      await pool.query(
        "update workspace_reservations set active_payment_attempt_id = $2 where id = $1",
        [id, attemptRows[0]!.id]
      );
      return id;
    };

    beforeAll(async () => {
      if (!pgBin) return;
      workdir = mkdtempSync(join(tmpdir(), "reservation-order-gate-"));
      dataDir = join(workdir, "data");
      const socketDir = join(workdir, "socket");
      mkdirSync(socketDir, { recursive: true });
      port = 20_000 + Math.floor(Math.random() * 20_000);
      await run("initdb", [
        "-D",
        dataDir,
        "-U",
        "workspace",
        "--auth=trust",
        "-E",
        "UTF8",
      ]);
      await run("pg_ctl", [
        "-D",
        dataDir,
        "-o",
        `-p ${port} -k ${socketDir} -c fsync=off`,
        "-l",
        join(workdir, "server.log"),
        "start",
      ]);
      await run("createdb", [
        "-h",
        join(workdir, "socket"),
        "-p",
        String(port),
        "-U",
        "workspace",
        "gate",
      ]);
      pool = makeDatabasePool({
        connectionString: baseUrl(),
        max: 4,
        statement_timeout: 30_000,
        query_timeout: 30_000,
        idleTimeoutMillis: 1_000,
      });
      db = await Effect.runPromise(makeDatabaseClient(pool));
    }, 60_000);

    afterAll(async () => {
      if (!pgBin || !workdir) return;
      await pool?.end().catch(() => {});
      await run("pg_ctl", ["-D", dataDir, "stop", "-m", "immediate"]).catch(
        () => {}
      );
      rmSync(workdir, { recursive: true, force: true });
    });

    const preBridgeTags = () => {
      const index = allTags.indexOf(bridgeTag);
      expect(index).toBeGreaterThan(0);
      return allTags.slice(0, index);
    };

    test("applies the full chain up to the pre-bridge schema from scratch", async () => {
      await applyMigrations(preBridgeTags());
      const { rows: columns } = await pool.query(
        `select column_name from information_schema.columns
          where table_name = 'payment_attempts' and column_name = 'order_id'`
      );
      // Old schema: payment attempts have no order linkage at all.
      expect(columns).toHaveLength(0);
    });

    test("an old writer leaves reservations and attempts without order rows", async () => {
      await oldWriterReservation({ paymentState: "paid", fulfilled: false });
      await oldWriterReservation({ paymentState: "failed", fulfilled: false });

      const { rows: counts } = await pool.query(
        "select (select count(*) from workspace_reservations) as reservations, (select count(*) from orders) as orders"
      );
      expect(counts[0]).toEqual({ reservations: "2", orders: "0" });
    });

    test("the bridge migration backfills orders and links attempts", async () => {
      await applyMigrations([bridgeTag]);

      const { rows } = await pool.query(
        `select
           (select count(*) from workspace_reservations) as reservations,
           (select count(*) from orders where kind = 'reservation') as orders,
           (select count(*) from payment_attempts where order_id is null) as unlinked_attempts`
      );
      expect(rows[0]).toEqual({
        reservations: "2",
        orders: "2",
        unlinked_attempts: "0",
      });
      // The mirror is lossless: every order copies its reservation facts.
      const { rows: mismatches } = await pool.query(
        `select count(*) as n from orders o
           join workspace_reservations r on r.id = o.id
          where o.correlation_id <> r.correlation_id
             or o.dotypos_customer_id <> r.dotypos_customer_id
             or o.payment_state <> r.payment_state
             or o.fulfillment_state <> r.fulfillment_state
             or o.paid_at is distinct from r.paid_at
             or o.fulfilled_at is distinct from r.fulfilled_at`
      );
      expect(mismatches[0]!.n).toBe("0");
    });

    test("an old writer can still write rows without orders after the backfill", async () => {
      const id = await oldWriterReservation({
        paymentState: "pending",
        fulfilled: false,
      });
      await pool.query(
        "update payment_attempts set order_id = null where workspace_reservation_id = $1",
        [id]
      );
      const { rows } = await pool.query(
        `select
           (select count(*) from workspace_reservations where id not in (select id from orders)) as reservations_without_orders,
           (select count(*) from payment_attempts where order_id is null) as unlinked_attempts`
      );
      expect(rows[0]).toEqual({
        reservations_without_orders: "1",
        unlinked_attempts: "1",
      });
    });

    test("ensureReservationOrder repairs missing orders idempotently", async () => {
      const { rows: missing } = await pool.query(
        "select id from workspace_reservations where id not in (select id from orders) limit 1"
      );
      const id = workspaceReservationIdSchema.make(missing[0]!.id as string);
      const [reservation] = await Effect.runPromise(
        db.select().from(workspaceReservations).where(eqId(id))
      );
      expect(reservation).toBeDefined();

      await Effect.runPromise(
        db.transaction((tx) =>
          ensureReservationOrder({ tx, reservation: reservation! })
        )
      );
      await Effect.runPromise(
        db.transaction((tx) =>
          ensureReservationOrder({ tx, reservation: reservation! })
        )
      );

      const { rows: orderRows } = await pool.query(
        "select id, kind, payment_state from orders where id = $1",
        [id]
      );
      expect(orderRows).toHaveLength(1);
      expect(orderRows[0]).toMatchObject({
        id,
        kind: "reservation",
        payment_state: "pending",
      });
      // The reservation-only mirror restores the order row, but it must
      // never touch payment attempts: the legacy attempt relink happens on
      // the attempt-first payment path (markPaid below), which holds the
      // attempt lock before the reservation lock.
      const { rows: attemptRows } = await pool.query(
        "select order_id from payment_attempts where workspace_reservation_id = $1",
        [id]
      );
      expect(attemptRows).toHaveLength(1);
      expect(attemptRows[0]!.order_id).toBeNull();
    });

    test("the webhook-complete path runs on repaired data without rejected writes", async () => {
      const { rows: pending } = await pool.query(
        `select r.id, r.active_payment_attempt_id from workspace_reservations r
          where r.payment_state = 'pending' and r.active_payment_attempt_id is not null
          order by r.created_at limit 1`
      );
      const id = workspaceReservationIdSchema.make(pending[0]!.id as string);
      const paidAt = Temporal.Now.instant();

      const layer = Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db })
      );
      const { PaymentLifecycleRepository } = await import(
        "@/features/checkout/backend/repositories/payment-lifecycle.repository"
      );
      const repository = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* PaymentLifecycleRepository;
        }).pipe(
          Effect.provide(
            PaymentLifecycleRepository.Default.pipe(Layer.provide(layer))
          )
        )
      );
      const transition = await Effect.runPromise(
        repository.markPaid({
          id: pending[0]!.active_payment_attempt_id as never,
          workspaceReservationId: id,
          providerStatus: "APPROVED",
          paidAt,
        })
      );
      expect(transition.changed).toBe(true);

      const { rows: orderRows } = await pool.query(
        "select payment_state, paid_at from orders where id = $1",
        [id]
      );
      expect(orderRows[0]!.payment_state).toBe("paid");
      expect(orderRows[0]!.paid_at).not.toBeNull();

      // The webhook run also persisted the attempt → order linkage.
      const { rows: attemptRows } = await pool.query(
        "select order_id from payment_attempts where workspace_reservation_id = $1",
        [id]
      );
      expect(attemptRows[0]!.order_id).toBe(id);
    });

    test("a markPaid replay repairs missing and stale orders and keeps fulfillment facts", async () => {
      // Old-writer paid reservation whose order was never written; the
      // attempt stays unlinked too. Already fulfilled, so the replay must
      // not clobber fulfillment facts.
      const id = await oldWriterReservation({
        paymentState: "paid",
        fulfilled: true,
      });
      // Keep the delivery leg from picking this already-fulfilled row.
      await pool.query(
        "update workspace_reservations set reservation_state = 'confirmed' where id = $1",
        [id]
      );
      const attemptId = (
        await pool.query(
          "select id from payment_attempts where workspace_reservation_id = $1 limit 1",
          [id]
        )
      ).rows[0]!.id as string;

      const layer = Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db })
      );
      const { PaymentLifecycleRepository } = await import(
        "@/features/checkout/backend/repositories/payment-lifecycle.repository"
      );
      const repository = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* PaymentLifecycleRepository;
        }).pipe(
          Effect.provide(
            PaymentLifecycleRepository.Default.pipe(Layer.provide(layer))
          )
        )
      );
      const replay = () =>
        Effect.runPromise(
          repository.markPaid({
            id: attemptId as never,
            workspaceReservationId: id,
            providerStatus: "APPROVED",
            paidAt: Temporal.Now.instant(),
          })
        );

      const first = await replay();
      expect(first.changed).toBe(false);

      // Missing order: drop it (unlinking attempts first) and replay again.
      await pool.query(
        "update payment_attempts set order_id = null where workspace_reservation_id = $1",
        [id]
      );
      await pool.query("delete from orders where id = $1", [id]);
      expect((await replay()).changed).toBe(false);

      const { rows: repaired } = await pool.query(
        `select payment_state, fulfilled_at from orders where id = $1`,
        [id]
      );
      expect(repaired).toHaveLength(1);
      expect(repaired[0]!.payment_state).toBe("paid");
      // The already-fulfilled reservation's fulfillment facts survive.
      expect(repaired[0]!.fulfilled_at).not.toBeNull();

      // Stale order: rewind the mirrored payment facts and replay again.
      await pool.query(
        "update orders set payment_state = 'pending', paid_at = null where id = $1",
        [id]
      );
      expect((await replay()).changed).toBe(false);
      const { rows: refreshed } = await pool.query(
        "select payment_state, paid_at from orders where id = $1",
        [id]
      );
      expect(refreshed[0]!.payment_state).toBe("paid");
      expect(refreshed[0]!.paid_at).not.toBeNull();

      const { rows: attemptRows } = await pool.query(
        "select order_id, state from payment_attempts where workspace_reservation_id = $1",
        [id]
      );
      expect(attemptRows[0]!.order_id).toBe(id);
      expect(attemptRows[0]!.state).toBe("paid");
    });

    test("a markTerminal replay repairs the mirror and attempt linkage", async () => {
      const id = await oldWriterReservation({
        paymentState: "pending",
        fulfilled: false,
      });
      const attemptId = (
        await pool.query(
          "select id from payment_attempts where workspace_reservation_id = $1 limit 1",
          [id]
        )
      ).rows[0]!.id as string;

      const layer = Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db })
      );
      const { PaymentLifecycleRepository } = await import(
        "@/features/checkout/backend/repositories/payment-lifecycle.repository"
      );
      const repository = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* PaymentLifecycleRepository;
        }).pipe(
          Effect.provide(
            PaymentLifecycleRepository.Default.pipe(Layer.provide(layer))
          )
        )
      );
      const terminal = (expired: boolean) =>
        Effect.runPromise(
          repository.markTerminal({
            id: attemptId as never,
            workspaceReservationId: id,
            state: "expired",
            failureCode: "hold_expired",
            providerStatus: expired ? "EXPIRED" : undefined,
          })
        );

      const first = await terminal(true);
      expect(first.changed).toBe(true);

      // Old-writer shape again: no order, unlinked attempt.
      await pool.query(
        "update payment_attempts set order_id = null where workspace_reservation_id = $1",
        [id]
      );
      await pool.query("delete from orders where id = $1", [id]);

      const replay = await terminal(false);
      expect(replay.changed).toBe(false);

      const { rows: orderRows } = await pool.query(
        "select payment_state from orders where id = $1",
        [id]
      );
      expect(orderRows).toHaveLength(1);
      expect(orderRows[0]!.payment_state).toBe("expired");

      const { rows: attemptRows } = await pool.query(
        "select order_id, state from payment_attempts where workspace_reservation_id = $1",
        [id]
      );
      expect(attemptRows[0]!.order_id).toBe(id);
      expect(attemptRows[0]!.state).toBe("expired");
    });

    test("the recovery settle path repairs and settles without state loss", async () => {
      const { rows: failed } = await pool.query(
        `select r.id, r.active_payment_attempt_id from workspace_reservations r
          where r.payment_state = 'failed' and r.active_payment_attempt_id is not null
          order by r.created_at limit 1`
      );
      const id = workspaceReservationIdSchema.make(failed[0]!.id as string);
      const verifiedPaidAt = Temporal.Now.instant();

      const layer = Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db })
      );
      const { LatePaymentRecoveryRepository } = await import(
        "@/features/checkout/backend/repositories/late-payment-recovery.repository"
      );
      const repository = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* LatePaymentRecoveryRepository;
        }).pipe(
          Effect.provide(
            LatePaymentRecoveryRepository.Default.pipe(Layer.provide(layer))
          )
        )
      );
      await Effect.runPromise(
        repository.start({
          paymentAttemptId: failed[0]!.active_payment_attempt_id as never,
          workspaceReservationId: id,
          webhookEventId: `event-${crypto.randomUUID()}` as never,
          providerStatus: "APPROVED",
          verifiedPaidAt,
        })
      );
      const claimed = await Effect.runPromise(
        repository.claim({
          paymentAttemptId: failed[0]!.active_payment_attempt_id as never,
          staleProcessingBefore: Temporal.Now.instant(),
        })
      );
      expect(claimed?.state).toBe("processing");
      await Effect.runPromise(
        repository.completeUsingOriginalReservation({
          paymentAttemptId: failed[0]!.active_payment_attempt_id as never,
          workspaceReservationId: id,
          reservationState: "confirmed",
          completedAt: Temporal.Now.instant(),
        })
      );

      const { rows: orderRows } = await pool.query(
        "select payment_state, paid_at from orders where id = $1",
        [id]
      );
      expect(orderRows[0]!.payment_state).toBe("paid");

      const { rows: attemptRows } = await pool.query(
        "select state, order_id from payment_attempts where workspace_reservation_id = $1",
        [id]
      );
      expect(attemptRows[0]!.state).toBe("paid");
      expect(attemptRows[0]!.order_id).toBe(id);
    });

    test("the delivery leg reaches fulfilled on the reservation without rejected writes", async () => {
      const { rows: paid } = await pool.query(
        "select id from workspace_reservations where payment_state = 'paid' and reservation_state = 'held' order by created_at limit 1"
      );
      const id = workspaceReservationIdSchema.make(paid[0]!.id as string);

      const layer = Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db })
      );
      const { WorkspaceReservationRepository } = await import(
        "@/features/reservation/backend/workspace-reservation.repository"
      );
      const repository = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* WorkspaceReservationRepository;
        }).pipe(
          Effect.provide(
            WorkspaceReservationRepository.Default.pipe(Layer.provide(layer))
          )
        )
      );
      await Effect.runPromise(
        repository.claimPaidFulfillment({
          id,
          staleProcessingBefore: Temporal.Now.instant(),
        })
      );
      await Effect.runPromise(
        repository.markFulfilled({ id, fulfilledAt: Temporal.Now.instant() })
      );

      const { rows: reservationRows } = await pool.query(
        "select fulfillment_state, fulfilled_at from workspace_reservations where id = $1",
        [id]
      );
      // The authoritative invoice gate (fulfilled + fulfilledAt) holds on the
      // reservation source of truth.
      expect(reservationRows[0]!.fulfillment_state).toBe("fulfilled");
      expect(reservationRows[0]!.fulfilled_at).not.toBeNull();
    });

    test("rollback leg: another old-writer shape then forward repair once more", async () => {
      const id = await oldWriterReservation({
        paymentState: "pending",
        fulfilled: false,
      });
      await pool.query(
        "update payment_attempts set order_id = null where workspace_reservation_id = $1",
        [id]
      );

      const before = await pool.query("select count(*) as n from orders");
      const [reservation] = await Effect.runPromise(
        db.select().from(workspaceReservations).where(eqId(id))
      );
      await Effect.runPromise(
        db.transaction((tx) =>
          ensureReservationOrder({ tx, reservation: reservation! })
        )
      );
      const after = await pool.query(
        "select count(*) as n from orders where id = $1",
        [id]
      );

      expect(Number(before.rows[0]!.n)).toBeGreaterThan(0);
      expect(after.rows).toHaveLength(1);

      // The reservation-only mirror must not have relinked the old writer's
      // unlinked attempt; the persisted linkage is repaired by the
      // attempt-first payment path instead.
      const { rows: unrepaired } = await pool.query(
        "select order_id from payment_attempts where workspace_reservation_id = $1",
        [id]
      );
      expect(unrepaired[0]!.order_id).toBeNull();

      const layer = Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db })
      );
      const { PaymentLifecycleRepository } = await import(
        "@/features/checkout/backend/repositories/payment-lifecycle.repository"
      );
      const repository = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* PaymentLifecycleRepository;
        }).pipe(
          Effect.provide(
            PaymentLifecycleRepository.Default.pipe(Layer.provide(layer))
          )
        )
      );
      const attemptId = (
        await pool.query(
          "select id from payment_attempts where workspace_reservation_id = $1 limit 1",
          [id]
        )
      ).rows[0]!.id as string;
      await Effect.runPromise(
        repository.markPaid({
          id: attemptId as never,
          workspaceReservationId: workspaceReservationIdSchema.make(
            id as string
          ),
          providerStatus: "APPROVED",
          paidAt: Temporal.Now.instant(),
        })
      );

      // The payment path relinked the old writer's unlinked attempt in the
      // persisted row, so the read model no longer needs to synthesize.
      const { rows: attemptRows } = await pool.query(
        `select id,
                order_id as "orderId",
                workspace_reservation_id as "workspaceReservationId",
                provider, provider_order_id as "providerOrderId",
                security_token as "securityToken", state,
                refund_state as "refundState",
                amount_value as "amountValue",
                amount_exponent as "amountExponent",
                currency, provider_redirect_url as "providerRedirectUrl",
                last_webhook_event_id as "lastWebhookEventId",
                last_provider_operation_id as "lastProviderOperationId",
                last_provider_status as "lastProviderStatus",
                failure_code as "failureCode",
                provider_order_created_at as "providerOrderCreatedAt",
                created_at as "createdAt", updated_at as "updatedAt"
           from payment_attempts where workspace_reservation_id = $1`,
        [id]
      );
      expect(attemptRows[0]!.orderId).toBe(id);
      const { toPaymentAttempt } = await import(
        "@/features/checkout/backend/repositories/payment-attempt.repository"
      );
      const attempt = toPaymentAttempt(attemptRows[0] as never);
      expect(attempt.orderId).toBe(id);
    });

    test("old recovery FOR UPDATE cannot deadlock a reservation order mirror", async () => {
      const id = await oldWriterReservation({
        paymentState: "paid",
        fulfilled: false,
      });
      const {
        rows: [attempt],
      } = await pool.query(
        "select id from payment_attempts where workspace_reservation_id = $1",
        [id]
      );
      await pool.query(
        "update payment_attempts set state = 'paid' where id = $1",
        [attempt!.id]
      );
      await pool.query(
        "update workspace_reservations set fulfillment_state = 'processing' where id = $1",
        [id]
      );

      const layer = Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db })
      );
      const { WorkspaceReservationRepository } = await import(
        "@/features/reservation/backend/workspace-reservation.repository"
      );
      const repository = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* WorkspaceReservationRepository;
        }).pipe(
          Effect.provide(
            WorkspaceReservationRepository.Default.pipe(Layer.provide(layer))
          )
        )
      );

      const old = await pool.connect();
      let mirror: Promise<void> | undefined;
      try {
        await old.query("begin");
        await old.query(
          "select id from payment_attempts where id = $1 for update",
          [attempt!.id]
        );

        mirror = Effect.runPromise(
          repository.markFulfilled({
            id,
            fulfilledAt: Temporal.Now.instant(),
          })
        );
        const mirrorOutcome = await Promise.race([
          mirror.then(
            () => "completed" as const,
            () => "failed" as const
          ),
          new Promise<"blocked">((resolve) =>
            setTimeout(() => resolve("blocked"), 1_000)
          ),
        ]);
        expect(mirrorOutcome).toBe("completed");

        const oldRecovery = await old.query(
          "select id from workspace_reservations where id = $1 for update",
          [id]
        );
        expect(oldRecovery.rowCount).toBe(1);
        await old.query(
          "update workspace_reservations set updated_at = updated_at where id = $1",
          [id]
        );
        await old.query("commit");
        expect((await Promise.allSettled([mirror]))[0]?.status).toBe(
          "fulfilled"
        );
      } finally {
        await old.query("rollback").catch(() => {});
        if (mirror) await Promise.allSettled([mirror]);
        old.release();
      }
    });
  }
);
