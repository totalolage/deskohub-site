import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { type EmailDeliveryId, EmailDeliveryIdSchema } from "@deskohub/email";
import { eq, inArray } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Context,
  Deferred,
  Effect,
  type Fiber,
  Layer,
  Logger,
  type LogLevel,
  Option,
  References,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import {
  type PostHogEmailDeliveryStatus,
  postHogEmailDeliveries,
} from "@/db/schema/posthog-email-deliveries";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type DeliveryReport,
  DeliveryReportError,
  type DeliveryReportEvent,
  deliveryReportHandler,
  processedDeliveryReport,
} from "./delivery-reports";
import type { EmailKind } from "./email-kind";
import { PostHogEmailDeliveryRepository } from "./posthog-email-deliveries.repository";
import {
  PostHogEmailDeliveryPolling,
  type PostHogEmailDeliveryPollSummary,
  type PostHogEmailDeliveryPollTrigger,
} from "./posthog-email-delivery-polling";
import {
  type PostHogEmailStatus,
  PostHogEmailStatusError,
  type PostHogEmailStatusLookup,
} from "./posthog-email-status-client";
import { PostHogEmailStatusReader } from "./posthog-email-status-reader";

// A poll claims from the whole table (its per-minute read budget counts every
// recent read), so the suite owns its database and empties the table per case.
const database = await createWorkspacePostgresSuiteDatabase(
  "posthog_email_delivery_polling"
);
afterAll(() => database?.close());

const start = Temporal.Instant.from("2026-11-09T12:00:00Z");
const minutesAfter = (minutes: number) => start.add({ minutes });
const hoursBefore = (hours: number) => start.subtract({ hours });
const statusTime = Temporal.Instant.from("2026-11-09T11:59:30Z");

const deploymentEnvironment = "preview";

const noteMetadata = Schema.Struct({ noteId: Schema.NonEmptyString });
const noteKind: EmailKind<typeof noteMetadata.Type> = {
  category: "posthog-poll-note",
  metadata: Schema.toStandardSchemaV1(noteMetadata),
};
const flakyKind: EmailKind<typeof noteMetadata.Type> = {
  category: "posthog-poll-flaky",
  metadata: Schema.toStandardSchemaV1(noteMetadata),
};
const noteTags = {
  category: noteKind.category,
  noteId: "note-1",
  deploymentEnvironment,
};

const finalEvents: readonly DeliveryReportEvent[] = [
  "email.delivered",
  "email.failed",
  "email.bounced",
  "email.complained",
];

type RecordedReport = DeliveryReport<
  typeof noteMetadata.Type,
  DeliveryReportEvent
>;
let reports: RecordedReport[];
let flakyFailuresLeft: number;

/** The handlers' own service, which the polling layer must provide them. */
class ReportLedger extends Context.Service<
  ReportLedger,
  { readonly record: (report: RecordedReport) => Effect.Effect<void> }
>()("test/PostHogPollReportLedger") {}

const reportLedger = Layer.succeed(ReportLedger, {
  record: (report) =>
    Effect.sync(() => {
      reports.push(report);
    }),
});

const recordReport = (report: RecordedReport) =>
  Effect.service(ReportLedger).pipe(
    Effect.flatMap((ledger) => ledger.record(report)),
    Effect.as(processedDeliveryReport)
  );

const handlers = [
  deliveryReportHandler(noteKind, finalEvents, recordReport),
  deliveryReportHandler(flakyKind, finalEvents, (report) =>
    flakyFailuresLeft-- > 0
      ? Effect.fail(
          new DeliveryReportError({
            errorCode: "posthog_poll_flaky_failed",
            message: "Synthetic handler failure.",
          })
        )
      : recordReport(report)
  ),
];

type StatusRead = Effect.Effect<
  PostHogEmailStatusLookup,
  PostHogEmailStatusError
>;
type ScriptedRead =
  | PostHogEmailStatusLookup
  | PostHogEmailStatusError
  | StatusRead;
/** Each message's reads in order; a message without one is not found yet. */
let script: Map<EmailDeliveryId, ScriptedRead[]>;
let reads: EmailDeliveryId[];

const found = (
  status: PostHogEmailStatus,
  details: { readonly reason?: string; readonly statusAt?: Date | null } = {}
): PostHogEmailStatusLookup => ({
  _tag: "Found",
  report: {
    messageId: "scripted",
    status,
    createdAt: new Date(hoursBefore(1).epochMilliseconds),
    statusAt:
      details.statusAt === undefined
        ? new Date(statusTime.epochMilliseconds)
        : details.statusAt,
    reason: details.reason ?? null,
  },
});
const notFoundYet: PostHogEmailStatusLookup = { _tag: "NotFoundYet" };
const statusError = (reason: PostHogEmailStatusError["reason"]) =>
  new PostHogEmailStatusError({ reason });

const scriptedReader = Layer.succeed(PostHogEmailStatusReader, {
  read: Option.some((messageId: EmailDeliveryId) =>
    Effect.suspend(() => {
      reads.push(messageId);
      const next = script.get(messageId)?.shift() ?? notFoundYet;
      if (next instanceof PostHogEmailStatusError) return Effect.fail(next);
      return Effect.isEffect(next) ? next : Effect.succeed(next);
    })
  ),
});
const unconfiguredReader = Layer.succeed(PostHogEmailStatusReader, {
  read: Option.none(),
});

const unusableRepository = Layer.succeed(PostHogEmailDeliveryRepository, {
  expireRetentionEnded: () => Effect.die("unexpected database access"),
  claim: () => Effect.die("unexpected database access"),
  recordPoll: () => Effect.die("unexpected database access"),
  settle: () => Effect.die("unexpected database access"),
  deleteSettled: () => Effect.die("unexpected database access"),
});

const queryError = new EffectDrizzleQueryError({
  query: "select synthetic",
  params: [],
  cause: new Error("synthetic connection failure"),
});
const failingClaimRepository = Layer.succeed(PostHogEmailDeliveryRepository, {
  expireRetentionEnded: () => Effect.succeed(0),
  claim: () => Effect.fail(queryError),
  recordPoll: () => Effect.die("unexpected recordPoll"),
  settle: () => Effect.die("unexpected settle"),
  deleteSettled: () => Effect.die("unexpected deleteSettled"),
});

const runId = crypto.randomUUID();
let sequence = 0;
const newMessageId = (): EmailDeliveryId =>
  EmailDeliveryIdSchema.make(
    `posthog-polling-${runId}-${String(++sequence).padStart(5, "0")}`
  );

interface DeliveryFixture {
  readonly tags?: Readonly<Record<string, string>>;
  readonly status?: PostHogEmailDeliveryStatus;
  readonly sentAt?: Temporal.Instant;
  readonly nextPollAt?: Temporal.Instant;
  readonly lastPolledAt?: Temporal.Instant | null;
  readonly settledAt?: Temporal.Instant | null;
  readonly pollCount?: number;
  readonly reads?: readonly ScriptedRead[];
}

const logAnnotations = (fiber: Fiber.Fiber<unknown, unknown>) =>
  fiber.getRef(References.CurrentLogAnnotations);

interface CapturedLog {
  readonly level: LogLevel.LogLevel;
  readonly message: unknown;
  readonly annotations: ReturnType<typeof logAnnotations>;
}

describe.skipIf(!database)("PostHog email delivery polling", () => {
  if (!database) return;

  let logs: CapturedLog[];

  const capturingLogger = Logger.layer([
    Logger.make(({ logLevel, message, fiber }) => {
      logs.push({
        level: logLevel,
        message,
        annotations: logAnnotations(fiber),
      });
    }),
  ]);

  const pollAt = (
    trigger: PostHogEmailDeliveryPollTrigger,
    at: Temporal.Instant,
    {
      reader = scriptedReader,
      repository = PostHogEmailDeliveryRepository.Default.pipe(
        Layer.provide(database.layer)
      ),
    }: {
      readonly reader?: Layer.Layer<PostHogEmailStatusReader>;
      readonly repository?: Layer.Layer<PostHogEmailDeliveryRepository>;
    } = {}
  ): Promise<PostHogEmailDeliveryPollSummary> =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(at.epochMilliseconds);
        const polling = yield* PostHogEmailDeliveryPolling;
        return yield* polling.poll(trigger);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            PostHogEmailDeliveryPolling.reportingTo(
              handlers,
              deploymentEnvironment
            ).pipe(
              Layer.provide(Layer.mergeAll(repository, reader, reportLedger))
            ),
            TestClock.layer(),
            capturingLogger
          )
        )
      )
    );

  const insertDeliveries = async (
    fixtures: readonly DeliveryFixture[]
  ): Promise<EmailDeliveryId[]> => {
    const rows = fixtures.map((fixture) => ({
      messageId: newMessageId(),
      tags: fixture.tags ?? noteTags,
      status: fixture.status ?? "queued",
      sentAt: fixture.sentAt ?? hoursBefore(1),
      nextPollAt: fixture.nextPollAt ?? start,
      lastPolledAt: fixture.lastPolledAt ?? null,
      settledAt: fixture.settledAt ?? null,
      pollCount: fixture.pollCount ?? 0,
    }));
    for (const [index, fixture] of fixtures.entries()) {
      if (fixture.reads) script.set(rows[index]!.messageId, [...fixture.reads]);
    }
    for (let offset = 0; offset < rows.length; offset += 500) {
      await Effect.runPromise(
        database.db
          .insert(postHogEmailDeliveries)
          .values(rows.slice(offset, offset + 500))
      );
    }
    return rows.map((row) => row.messageId);
  };

  const insertDelivery = async (fixture: DeliveryFixture = {}) => {
    const [id] = await insertDeliveries([fixture]);
    return id!;
  };

  const readDelivery = async (id: EmailDeliveryId) => {
    const [row] = await Effect.runPromise(
      database.db
        .select()
        .from(postHogEmailDeliveries)
        .where(eq(postHogEmailDeliveries.messageId, id))
    );
    return row;
  };

  const readDeliveries = (ids: readonly EmailDeliveryId[]) =>
    Effect.runPromise(
      database.db
        .select()
        .from(postHogEmailDeliveries)
        .where(inArray(postHogEmailDeliveries.messageId, [...ids]))
    );

  const reportedEvents = () =>
    reports.map((report) => [report.emailId, report.event]);

  beforeEach(async () => {
    await database.pool.query("delete from posthog_email_deliveries");
    script = new Map();
    reads = [];
    reports = [];
    logs = [];
    flakyFailuresLeft = 0;
  });

  describe("final statuses", () => {
    test("reports a delivery once it reaches a final status across polls", async () => {
      const id = await insertDelivery({
        reads: [found("queued"), found("sent"), found("delivered")],
      });

      expect(await pollAt("schedule", start)).toEqual({
        outcome: "polled",
        trigger: "schedule",
        polled: 1,
        settled: 0,
        expired: 0,
      });
      expect(await readDelivery(id)).toMatchObject({
        status: "queued",
        statusAt: statusTime,
        pollCount: 1,
        nextPollAt: minutesAfter(1),
        settledAt: null,
      });

      await pollAt("schedule", minutesAfter(1));
      expect(await readDelivery(id)).toMatchObject({
        status: "sent",
        pollCount: 2,
        nextPollAt: minutesAfter(3),
        settledAt: null,
      });
      expect(reports).toEqual([]);

      expect(await pollAt("schedule", minutesAfter(3))).toEqual({
        outcome: "polled",
        trigger: "schedule",
        polled: 1,
        settled: 1,
        expired: 0,
      });
      expect(reports).toEqual([
        {
          emailId: id,
          event: "email.delivered",
          occurredAt: statusTime,
          metadata: Option.some({ noteId: "note-1" }),
        },
      ] as never);
      expect(await readDelivery(id)).toMatchObject({
        status: "delivered",
        reason: null,
        statusAt: statusTime,
        settledAt: minutesAfter(3),
      });

      expect(await pollAt("signal", minutesAfter(20))).toMatchObject({
        polled: 0,
      });
      expect(reports).toHaveLength(1);
      expect(reads).toEqual([id, id, id]);
    });

    test("stores PostHog's reason with a failed delivery", async () => {
      const id = await insertDelivery({
        reads: [found("failed", { reason: "Mailbox unavailable" })],
      });

      await pollAt("schedule", start);

      expect(reportedEvents()).toEqual([[id, "email.failed"]]);
      expect(await readDelivery(id)).toMatchObject({
        status: "failed",
        reason: "Mailbox unavailable",
        statusAt: statusTime,
        settledAt: start,
      });
    });

    test.each(["bounced", "complained"] as const)(
      "reports and settles a %s delivery",
      async (status) => {
        const id = await insertDelivery({ reads: [found(status)] });

        expect(await pollAt("schedule", start)).toMatchObject({ settled: 1 });

        expect(reportedEvents()).toEqual([[id, `email.${status}`]]);
        expect(await readDelivery(id)).toMatchObject({
          status,
          settledAt: start,
        });
      }
    );

    test("dates a final status without PostHog's time by the poll", async () => {
      const id = await insertDelivery({
        reads: [found("delivered", { statusAt: null })],
      });

      await pollAt("schedule", start);

      expect(reports.map((report) => report.occurredAt)).toEqual([start]);
      expect(await readDelivery(id)).toMatchObject({
        status: "delivered",
        statusAt: null,
      });
    });

    test("settles a delivery its handler ignores, such as another deployment's", async () => {
      const id = await insertDelivery({
        tags: { ...noteTags, deploymentEnvironment: "production" },
        reads: [found("delivered")],
      });

      expect(await pollAt("schedule", start)).toMatchObject({ settled: 1 });

      expect(reports).toEqual([]);
      expect(await readDelivery(id)).toMatchObject({
        status: "delivered",
        settledAt: start,
      });
    });

    test("keeps a delivery pending when its handler fails, and settles it on a later poll", async () => {
      flakyFailuresLeft = 1;
      const id = await insertDelivery({
        tags: { ...noteTags, category: flakyKind.category },
        reads: [found("delivered"), found("delivered")],
      });

      expect(await pollAt("schedule", start)).toMatchObject({
        polled: 1,
        settled: 0,
      });
      expect(await readDelivery(id)).toMatchObject({
        status: "queued",
        pollCount: 1,
        nextPollAt: minutesAfter(1),
        settledAt: null,
      });
      expect(
        logs.filter((log) => log.level === "Warn").map((log) => log.annotations)
      ).toEqual([
        expect.objectContaining({
          messageId: id,
          errorCode: "posthog_poll_flaky_failed",
        }),
      ]);

      expect(await pollAt("schedule", minutesAfter(1))).toMatchObject({
        settled: 1,
      });
      expect(reportedEvents()).toEqual([[id, "email.delivered"]]);
      expect(await readDelivery(id)).toMatchObject({
        status: "delivered",
        settledAt: minutesAfter(1),
      });
    });
  });

  describe("deliveries PostHog does not know yet", () => {
    test("reads a delivery again after PostHog first does not find it", async () => {
      const id = await insertDelivery({
        reads: [notFoundYet, found("delivered")],
      });

      expect(await pollAt("schedule", start)).toMatchObject({
        polled: 1,
        settled: 0,
        expired: 0,
      });
      expect(await readDelivery(id)).toMatchObject({
        status: "queued",
        statusAt: null,
        pollCount: 1,
        nextPollAt: minutesAfter(1),
        settledAt: null,
      });

      await pollAt("schedule", minutesAfter(1));
      expect(reportedEvents()).toEqual([[id, "email.delivered"]]);
    });

    test("expires a delivery PostHog still does not find a day after sending", async () => {
      const lost = await insertDelivery({ sentAt: hoursBefore(24) });
      const recent = await insertDelivery({
        sentAt: hoursBefore(24).add({ seconds: 1 }),
      });

      expect(await pollAt("schedule", start)).toMatchObject({
        polled: 2,
        settled: 0,
        expired: 1,
      });

      expect(reports).toEqual([]);
      expect(await readDelivery(lost)).toMatchObject({
        status: "expired",
        reason: "not-found",
        settledAt: start,
      });
      expect(await readDelivery(recent)).toMatchObject({
        status: "queued",
        settledAt: null,
        nextPollAt: minutesAfter(1),
      });
    });
  });

  describe("PostHog failures", () => {
    test("expires a delivery whose status PostHog rejects", async () => {
      const id = await insertDelivery({ reads: [statusError("rejected")] });

      expect(await pollAt("schedule", start)).toMatchObject({
        polled: 1,
        expired: 1,
      });
      expect(await readDelivery(id)).toMatchObject({
        status: "expired",
        reason: "rejected",
        settledAt: start,
      });
    });

    test.each(["unavailable", "invalid-response"] as const)(
      "reads a delivery again later when PostHog is %s",
      async (reason) => {
        const failing = await insertDelivery({
          nextPollAt: start.subtract({ minutes: 2 }),
          reads: [statusError(reason)],
        });
        const next = await insertDelivery({ reads: [found("delivered")] });

        expect(await pollAt("schedule", start)).toEqual({
          outcome: "polled",
          trigger: "schedule",
          polled: 2,
          settled: 1,
          expired: 0,
        });
        expect(await readDelivery(failing)).toMatchObject({
          status: "queued",
          pollCount: 1,
          nextPollAt: minutesAfter(1),
          settledAt: null,
        });
        expect(reportedEvents()).toEqual([[next, "email.delivered"]]);
      }
    );

    test.each([
      ["rate-limited", false],
      ["unauthorized", true],
    ] as const)(
      "stops reading the claimed deliveries once PostHog answers %s",
      async (reason, logsError) => {
        // Reads already running when PostHog refuses may finish; the
        // deliveries past the first ten start only after the refusal.
        const ids = await insertDeliveries(
          Array.from({ length: 12 }, (_, index) => ({
            nextPollAt: start.subtract({ seconds: 12 - index }),
            reads: index === 0 ? [statusError(reason)] : [notFoundYet],
          }))
        );
        const [stopping, ...rest] = ids;
        const unread = rest.slice(-2);

        expect(await pollAt("schedule", start)).toEqual({
          outcome: "polled",
          trigger: "schedule",
          polled: reads.length,
          settled: 0,
          expired: 0,
          stoppedBy: reason,
        });

        expect(reads).not.toContain(unread[0]);
        expect(reads).not.toContain(unread[1]);
        for (const row of await readDeliveries([stopping!, ...unread])) {
          expect(row).toMatchObject({ status: "queued", pollCount: 0 });
          expect(row.nextPollAt.epochMilliseconds).toBeLessThan(
            start.epochMilliseconds
          );
        }
        expect(
          logs.some(
            (log) =>
              log.level === "Error" &&
              log.annotations.messageId === stopping &&
              log.annotations.reason === "unauthorized"
          )
        ).toBe(logsError);
      }
    );

    test("names the first refusal and lets reads already running finish", async () => {
      const allStarted = Deferred.makeUnsafe<void>();
      const firstRefused = Deferred.makeUnsafe<void>();
      let inFlight = 0;
      let mostInFlight = 0;
      const gated = (answer: StatusRead): StatusRead =>
        Effect.suspend(() => {
          inFlight += 1;
          mostInFlight = Math.max(mostInFlight, inFlight);
          return Effect.when(
            Deferred.succeed(allStarted, undefined),
            Effect.sync(() => inFlight === 10)
          ).pipe(
            Effect.andThen(Deferred.await(allStarted)),
            Effect.andThen(answer),
            Effect.ensuring(
              Effect.sync(() => {
                inFlight -= 1;
              })
            )
          );
        });
      const afterFirstRefusal = <A, E>(answer: Effect.Effect<A, E>) =>
        Deferred.await(firstRefused).pipe(
          Effect.andThen(Effect.yieldNow),
          Effect.andThen(answer)
        );

      // The first ten reads wait for each other; the first refuses, the
      // second refuses after it, the other eight answer after the refusal.
      const gatedReads: readonly StatusRead[] = [
        gated(
          Deferred.succeed(firstRefused, undefined).pipe(
            Effect.andThen(Effect.fail(statusError("rate-limited")))
          )
        ),
        gated(afterFirstRefusal(Effect.fail(statusError("unauthorized")))),
        ...Array.from({ length: 8 }, () =>
          gated(afterFirstRefusal(Effect.succeed(notFoundYet)))
        ),
      ];
      const ids = await insertDeliveries(
        Array.from({ length: 12 }, (_, index) => ({
          nextPollAt: start.subtract({ seconds: 12 - index }),
          reads: [gatedReads[index] ?? notFoundYet],
        }))
      );

      expect(await pollAt("schedule", start)).toEqual({
        outcome: "polled",
        trigger: "schedule",
        polled: 10,
        settled: 0,
        expired: 0,
        stoppedBy: "rate-limited",
      });

      expect(mostInFlight).toBe(10);
      expect(reads.toSorted()).toEqual(ids.slice(0, 10).toSorted());
      const rows = new Map(
        (await readDeliveries(ids)).map((row) => [row.messageId, row])
      );
      expect(ids.map((id) => rows.get(id)?.pollCount)).toEqual([
        0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
      ]);
    });
  });

  test("keeps at most ten reads in flight", async () => {
    const release = Deferred.makeUnsafe<void>();
    let inFlight = 0;
    const held: StatusRead = Effect.sync(() => {
      inFlight += 1;
    }).pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.as(notFoundYet),
      Effect.ensuring(
        Effect.sync(() => {
          inFlight -= 1;
        })
      )
    );
    await insertDeliveries(
      Array.from({ length: 15 }, () => ({ reads: [held] }))
    );

    const poll = pollAt("schedule", start);
    for (let waited = 0; reads.length < 10 && waited < 5000; waited += 10) {
      await Bun.sleep(10);
    }
    await Bun.sleep(50);
    const heldReads = { inFlight, reads: reads.length };
    Effect.runSync(Deferred.succeed(release, undefined));

    expect(heldReads).toEqual({ inFlight: 10, reads: 10 });
    expect(await poll).toMatchObject({ polled: 15 });
  });

  describe("scheduling", () => {
    test("backs off 1, 2, 5, 15 and then every 15 minutes", async () => {
      const id = await insertDelivery();
      const gaps: number[] = [];
      let at = start;

      for (let poll = 0; poll < 5; poll += 1) {
        await pollAt("schedule", at);
        const row = await readDelivery(id);
        gaps.push(at.until(row!.nextPollAt).total("minutes"));
        at = row!.nextPollAt;
      }

      expect(gaps).toEqual([1, 2, 5, 15, 15]);
      expect(await readDelivery(id)).toMatchObject({ pollCount: 5 });
    });

    test("a signal reads deliveries not due yet, at most every 30 seconds", async () => {
      const id = await insertDelivery({ nextPollAt: minutesAfter(10) });

      expect(await pollAt("schedule", start)).toMatchObject({ polled: 0 });
      expect(await pollAt("signal", start)).toEqual({
        outcome: "polled",
        trigger: "signal",
        polled: 1,
        settled: 0,
        expired: 0,
      });
      expect(await pollAt("signal", start.add({ seconds: 29 }))).toMatchObject({
        polled: 0,
      });
      expect(await pollAt("signal", start.add({ seconds: 30 }))).toMatchObject({
        polled: 1,
      });
      expect(reads).toEqual([id, id]);
    });

    test("reads at most 100 deliveries per poll", async () => {
      await insertDeliveries(Array.from({ length: 120 }, () => ({})));

      expect(await pollAt("schedule", start)).toMatchObject({ polled: 100 });
    });

    test("reads no more than the minute's remaining budget of 500", async () => {
      await insertDeliveries(
        Array.from({ length: 450 }, () => ({
          nextPollAt: minutesAfter(5),
          lastPolledAt: start.subtract({ seconds: 40 }),
        }))
      );
      await insertDeliveries(Array.from({ length: 80 }, () => ({})));

      expect(await pollAt("schedule", start)).toMatchObject({ polled: 50 });
    });
  });

  describe("retention", () => {
    test("expires a delivery PostHog no longer keeps without reading it", async () => {
      const id = await insertDelivery({
        sentAt: hoursBefore(30 * 24),
        nextPollAt: minutesAfter(10),
      });

      expect(await pollAt("signal", start)).toEqual({
        outcome: "polled",
        trigger: "signal",
        polled: 0,
        settled: 0,
        expired: 1,
      });
      expect(reads).toEqual([]);
      expect(await readDelivery(id)).toMatchObject({
        status: "expired",
        reason: "status-retention-ended",
        settledAt: start,
      });
    });

    test("a scheduled poll deletes deliveries settled 30 days ago; a signal keeps them", async () => {
      const old = await insertDelivery({
        status: "delivered",
        settledAt: hoursBefore(30 * 24),
      });
      const recent = await insertDelivery({
        status: "delivered",
        settledAt: hoursBefore(29 * 24),
      });

      await pollAt("signal", start);
      expect(await readDelivery(old)).toBeDefined();

      await pollAt("schedule", start);
      expect(await readDelivery(old)).toBeUndefined();
      expect(await readDelivery(recent)).toBeDefined();
    });
  });

  test("does nothing without a PostHog email secret key", async () => {
    expect(
      await pollAt("schedule", start, {
        reader: unconfiguredReader,
        repository: unusableRepository,
      })
    ).toEqual({ outcome: "not-configured" });
  });

  test("fails with the database's error and still logs one summary line", async () => {
    await expect(
      pollAt("schedule", start, { repository: failingClaimRepository })
    ).rejects.toBe(queryError);
    expect(reads).toEqual([]);
    expect(
      logs
        .filter((log) =>
          [log.message].flat().includes("PostHog email delivery poll")
        )
        .map((log) => [log.level, log.annotations])
    ).toEqual([["Info", { outcome: "failed", trigger: "schedule" }]]);
  });

  test("logs one summary line per poll", async () => {
    await insertDelivery({ reads: [found("delivered")] });
    await insertDelivery({ sentAt: hoursBefore(30 * 24) });

    await pollAt("schedule", start);

    expect(
      logs
        .filter((log) =>
          [log.message].flat().includes("PostHog email delivery poll")
        )
        .map((log) => [log.level, log.annotations])
    ).toEqual([
      [
        "Info",
        expect.objectContaining({
          trigger: "schedule",
          polled: 1,
          settled: 1,
          expired: 1,
        }),
      ],
    ]);
  });
});
