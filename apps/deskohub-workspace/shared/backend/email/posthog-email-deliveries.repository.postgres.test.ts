import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { type EmailDeliveryId, EmailDeliveryIdSchema } from "@deskohub/email";
import { eq, inArray } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer } from "effect";
import {
  type PostHogEmailDeliveryStatus,
  postHogEmailDeliveries,
} from "@/db/schema/posthog-email-deliveries";
import { holdPostgresTransaction } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type IPostHogEmailDeliveryRepository,
  PostHogEmailDeliveryRepository,
} from "./posthog-email-deliveries.repository";

// A claim reads the whole table (its per-minute budget counts every recent
// poll), so the suite owns its database and empties the table per case.
const database = await createWorkspacePostgresSuiteDatabase(
  "posthog_email_deliveries"
);
afterAll(() => database?.close());

const now = Temporal.Instant.from("2026-11-09T12:00:00Z");
const secondsAgo = (seconds: number) => now.subtract({ seconds });
const daysAgo = (days: number) => now.subtract({ hours: 24 * days });

const runId = crypto.randomUUID();
let sequence = 0;
const messageId = (): EmailDeliveryId =>
  EmailDeliveryIdSchema.make(
    `posthog-repository-${runId}-${String(++sequence).padStart(5, "0")}`
  );

interface DeliveryFixture {
  readonly messageId?: EmailDeliveryId;
  readonly status?: PostHogEmailDeliveryStatus;
  readonly sentAt?: Temporal.Instant;
  readonly nextPollAt?: Temporal.Instant;
  readonly lastPolledAt?: Temporal.Instant | null;
  readonly settledAt?: Temporal.Instant | null;
  readonly pollCount?: number;
}

describe.skipIf(!database)("PostHog email delivery repository", () => {
  if (!database) return;

  const runRepository = <A>(
    operation: (
      repository: IPostHogEmailDeliveryRepository
    ) => Effect.Effect<A, EffectDrizzleQueryError>
  ): Promise<A> =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* operation(yield* PostHogEmailDeliveryRepository);
      }).pipe(
        Effect.provide(
          PostHogEmailDeliveryRepository.Default.pipe(
            Layer.provide(database.layer)
          )
        )
      )
    );

  const insertDeliveries = async (
    fixtures: readonly DeliveryFixture[]
  ): Promise<EmailDeliveryId[]> => {
    const rows = fixtures.map((fixture) => ({
      messageId: fixture.messageId ?? messageId(),
      tags: { campaign: "synthetic" },
      status: fixture.status ?? "queued",
      sentAt: fixture.sentAt ?? secondsAgo(3600),
      nextPollAt: fixture.nextPollAt ?? secondsAgo(60),
      lastPolledAt: fixture.lastPolledAt ?? null,
      settledAt: fixture.settledAt ?? null,
      pollCount: fixture.pollCount ?? 0,
    }));
    await Effect.runPromise(
      database.db.insert(postHogEmailDeliveries).values(rows)
    );
    return rows.map((row) => row.messageId);
  };

  const insertDelivery = async (fixture: DeliveryFixture = {}) => {
    const [id] = await insertDeliveries([fixture]);
    return id!;
  };

  const readDeliveries = (ids: readonly EmailDeliveryId[]) =>
    Effect.runPromise(
      database.db
        .select()
        .from(postHogEmailDeliveries)
        .where(inArray(postHogEmailDeliveries.messageId, [...ids]))
    );

  const readDelivery = async (id: EmailDeliveryId) => {
    const [row] = await Effect.runPromise(
      database.db
        .select()
        .from(postHogEmailDeliveries)
        .where(eq(postHogEmailDeliveries.messageId, id))
    );
    return row;
  };

  const claimedIds = async (trigger: "schedule" | "signal") =>
    (
      await runRepository((repository) => repository.claim({ trigger, now }))
    ).map((delivery) => delivery.messageId);

  beforeEach(async () => {
    await database.pool.query("delete from posthog_email_deliveries");
  });

  describe("claim", () => {
    test("a scheduled claim takes only due rows", async () => {
      const overdue = await insertDelivery({ nextPollAt: secondsAgo(300) });
      const dueNow = await insertDelivery({ nextPollAt: now });
      await insertDelivery({ nextPollAt: now.add({ seconds: 1 }) });

      expect(await claimedIds("schedule")).toEqual([overdue, dueNow]);
    });

    test("a scheduled claim skips due rows polled within the last 30 seconds", async () => {
      await insertDelivery({ lastPolledAt: secondsAgo(10) });
      await insertDelivery({ lastPolledAt: secondsAgo(29) });
      const polledThirtySecondsAgo = await insertDelivery({
        nextPollAt: secondsAgo(120),
        lastPolledAt: secondsAgo(30),
      });
      const polledEarlier = await insertDelivery({
        nextPollAt: secondsAgo(90),
        lastPolledAt: secondsAgo(600),
      });

      expect(await claimedIds("schedule")).toEqual([
        polledThirtySecondsAgo,
        polledEarlier,
      ]);
    });

    test("a signal claims unsettled rows not polled in the last 30 seconds, due or not", async () => {
      const neverPolled = await insertDelivery({
        nextPollAt: now.add({ seconds: 900 }),
      });
      const polledThirtySecondsAgo = await insertDelivery({
        nextPollAt: now.add({ seconds: 901 }),
        lastPolledAt: secondsAgo(30),
      });
      await insertDelivery({
        nextPollAt: now.add({ seconds: 902 }),
        lastPolledAt: secondsAgo(10),
      });

      expect(await claimedIds("signal")).toEqual([
        neverPolled,
        polledThirtySecondsAgo,
      ]);
    });

    test("settled rows are never claimed", async () => {
      await insertDelivery({
        status: "delivered",
        settledAt: secondsAgo(600),
        nextPollAt: secondsAgo(900),
      });
      await insertDelivery({
        status: "expired",
        settledAt: secondsAgo(600),
        nextPollAt: secondsAgo(900),
        lastPolledAt: secondsAgo(600),
      });

      expect(await claimedIds("schedule")).toEqual([]);
      expect(await claimedIds("signal")).toEqual([]);
    });

    test("claims the oldest next poll first, marks each row polled now, and returns its poll state", async () => {
      const later = await insertDelivery({
        nextPollAt: secondsAgo(60),
        pollCount: 2,
        status: "sent",
      });
      const earlier = await insertDelivery({
        nextPollAt: secondsAgo(600),
        sentAt: daysAgo(1),
      });

      const claimed = await runRepository((repository) =>
        repository.claim({ trigger: "schedule", now })
      );

      expect(claimed).toEqual([
        {
          messageId: earlier,
          tags: { campaign: "synthetic" },
          status: "queued",
          sentAt: daysAgo(1),
          nextPollAt: secondsAgo(600),
          pollCount: 0,
        },
        {
          messageId: later,
          tags: { campaign: "synthetic" },
          status: "sent",
          sentAt: secondsAgo(3600),
          nextPollAt: secondsAgo(60),
          pollCount: 2,
        },
      ]);
      const stored = await readDeliveries([earlier, later]);
      expect(stored.map((row) => row.lastPolledAt?.equals(now))).toEqual([
        true,
        true,
      ]);
    });

    test("one claim takes at most 100 rows, the oldest due first", async () => {
      const ids = await insertDeliveries(
        Array.from({ length: 120 }, (_, index) => ({
          nextPollAt: secondsAgo(10_000 - index),
        }))
      );

      expect(await claimedIds("schedule")).toEqual(ids.slice(0, 100));
    });

    describe("the per-minute read budget of 500", () => {
      const insertRecentPolls = (count: number, polledSecondsAgo: number) =>
        insertDeliveries(
          Array.from({ length: count }, () => ({
            status: "delivered" as const,
            lastPolledAt: secondsAgo(polledSecondsAgo),
            settledAt: secondsAgo(polledSecondsAgo),
          }))
        );
      const insertClaimable = (count: number) =>
        insertDeliveries(
          Array.from({ length: count }, (_, index) => ({
            nextPollAt: secondsAgo(5_000 - index),
          }))
        );

      test("leaves 50 claims after 450 reads in the last minute", async () => {
        await insertRecentPolls(450, 59);
        const claimable = await insertClaimable(120);

        expect(await claimedIds("schedule")).toEqual(claimable.slice(0, 50));
      });

      test("leaves no claim after 500 reads in the last minute", async () => {
        await insertRecentPolls(500, 1);
        await insertClaimable(10);

        expect(await claimedIds("schedule")).toEqual([]);
        expect(await claimedIds("signal")).toEqual([]);
      });

      test("does not count reads 60 seconds old or older", async () => {
        await insertRecentPolls(450, 60);
        await insertRecentPolls(450, 61);
        const claimable = await insertClaimable(120);

        expect(await claimedIds("schedule")).toEqual(claimable.slice(0, 100));
      });
    });

    test("skips a row another transaction holds instead of waiting for it", async () => {
      const held = await insertDelivery({ nextPollAt: secondsAgo(600) });
      const free = await insertDelivery({ nextPollAt: secondsAgo(300) });
      const holder = await holdPostgresTransaction(
        database.pool,
        "select message_id from posthog_email_deliveries where message_id = $1 for update",
        [held]
      );
      try {
        expect(await claimedIds("schedule")).toEqual([free]);
      } finally {
        await holder.commit();
      }
      expect((await readDelivery(held))?.lastPolledAt).toBeNull();
    });

    test("concurrent claims never return the same row", async () => {
      const ids = await insertDeliveries(
        Array.from({ length: 150 }, (_, index) => ({
          nextPollAt: secondsAgo(10_000 - index),
        }))
      );

      const [first, second] = await Promise.all([
        claimedIds("schedule"),
        claimedIds("signal"),
      ]);

      const both = [...first, ...second];
      expect(new Set(both).size).toBe(both.length);
      expect(both.every((id) => ids.includes(id))).toBe(true);
    });
  });

  describe("expireRetentionEnded", () => {
    test("expires unsettled rows sent at least 30 days ago and counts them", async () => {
      const retentionEnded = await insertDelivery({
        sentAt: daysAgo(30),
        status: "sent",
      });
      const longAgo = await insertDelivery({ sentAt: daysAgo(45) });
      const recent = await insertDelivery({
        sentAt: daysAgo(30).add({ seconds: 1 }),
      });
      const alreadySettled = await insertDelivery({
        sentAt: daysAgo(40),
        status: "delivered",
        settledAt: daysAgo(39),
      });

      const expired = await runRepository((repository) =>
        repository.expireRetentionEnded(now)
      );

      expect(expired).toBe(2);
      for (const id of [retentionEnded, longAgo]) {
        const row = await readDelivery(id);
        expect(row).toMatchObject({
          status: "expired",
          reason: "status-retention-ended",
        });
        expect(row?.settledAt?.equals(now)).toBe(true);
      }
      expect(await readDelivery(recent)).toMatchObject({
        status: "queued",
        settledAt: null,
      });
      const settled = await readDelivery(alreadySettled);
      expect(settled?.status).toBe("delivered");
      expect(settled?.settledAt?.equals(daysAgo(39))).toBe(true);
    });
  });

  describe("recordPoll", () => {
    test("stores the progress status with the next poll", async () => {
      const id = await insertDelivery({ pollCount: 1 });

      await runRepository((repository) =>
        repository.recordPoll({
          messageId: id,
          status: "sent",
          statusAt: secondsAgo(20),
          pollCount: 2,
          nextPollAt: now.add({ seconds: 120 }),
        })
      );

      const row = await readDelivery(id);
      expect(row).toMatchObject({ status: "sent", pollCount: 2 });
      expect(row?.statusAt?.equals(secondsAgo(20))).toBe(true);
      expect(row?.nextPollAt.equals(now.add({ seconds: 120 }))).toBe(true);
      expect(row?.settledAt).toBeNull();
    });

    test("keeps the stored status when the poll brought none", async () => {
      const id = await insertDelivery({ status: "sent" });
      await runRepository((repository) =>
        repository.recordPoll({
          messageId: id,
          status: "sent",
          statusAt: secondsAgo(500),
          pollCount: 1,
          nextPollAt: now,
        })
      );

      await runRepository((repository) =>
        repository.recordPoll({
          messageId: id,
          pollCount: 2,
          nextPollAt: now.add({ seconds: 300 }),
        })
      );

      const row = await readDelivery(id);
      expect(row).toMatchObject({ status: "sent", pollCount: 2 });
      expect(row?.statusAt?.equals(secondsAgo(500))).toBe(true);
      expect(row?.nextPollAt.equals(now.add({ seconds: 300 }))).toBe(true);
    });
  });

  describe("settle", () => {
    test("stores the final status and settles the row now", async () => {
      const id = await insertDelivery({ status: "sent" });

      await runRepository((repository) =>
        repository.settle({
          messageId: id,
          status: "bounced",
          reason: "mailbox-full",
          statusAt: secondsAgo(40),
          now,
        })
      );

      const row = await readDelivery(id);
      expect(row).toMatchObject({ status: "bounced", reason: "mailbox-full" });
      expect(row?.statusAt?.equals(secondsAgo(40))).toBe(true);
      expect(row?.settledAt?.equals(now)).toBe(true);
    });

    test("leaves an already settled row as it was settled", async () => {
      const id = await insertDelivery({
        status: "delivered",
        settledAt: secondsAgo(100),
      });

      await runRepository((repository) =>
        repository.settle({
          messageId: id,
          status: "expired",
          reason: "not-found",
          statusAt: null,
          now,
        })
      );

      const row = await readDelivery(id);
      expect(row).toMatchObject({ status: "delivered", reason: null });
      expect(row?.settledAt?.equals(secondsAgo(100))).toBe(true);
    });
  });

  describe("deleteSettled", () => {
    test("deletes rows settled at least 30 days ago and counts them", async () => {
      const settledLongAgo = await insertDelivery({
        status: "delivered",
        sentAt: daysAgo(50),
        settledAt: daysAgo(45),
      });
      const settledThirtyDaysAgo = await insertDelivery({
        status: "expired",
        sentAt: daysAgo(31),
        settledAt: daysAgo(30),
      });
      const settledRecently = await insertDelivery({
        status: "delivered",
        sentAt: daysAgo(31),
        settledAt: daysAgo(30).add({ seconds: 1 }),
      });
      const unsettled = await insertDelivery({ sentAt: daysAgo(60) });

      const deleted = await runRepository((repository) =>
        repository.deleteSettled(now)
      );

      expect(deleted).toBe(2);
      const remaining = await readDeliveries([
        settledLongAgo,
        settledThirtyDaysAgo,
        settledRecently,
        unsettled,
      ]);
      expect(remaining.map((row) => row.messageId).toSorted()).toEqual(
        [settledRecently, unsettled].toSorted()
      );
    });
  });
});
