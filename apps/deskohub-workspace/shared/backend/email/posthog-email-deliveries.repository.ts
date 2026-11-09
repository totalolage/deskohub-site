import "@/shared/polyfills/temporal";

import type { EmailDeliveryId } from "@deskohub/email";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type PostHogEmailDeliveryStatus,
  postHogEmailDeliveries,
} from "@/db/schema/posthog-email-deliveries";
import type { PostHogEmailDeliveryPollTrigger } from "./posthog-email-delivery-polling";

/** A pending delivery a poll claimed, as it stood before this poll. */
export interface PostHogEmailDeliveryClaim {
  readonly messageId: EmailDeliveryId;
  readonly tags: Readonly<Record<string, string>>;
  readonly status: PostHogEmailDeliveryStatus;
  readonly sentAt: Temporal.Instant;
  readonly nextPollAt: Temporal.Instant;
  readonly pollCount: number;
}

/** PostHog's statuses of an email still on its way. */
export type PostHogEmailProgressStatus = Extract<
  PostHogEmailDeliveryStatus,
  "queued" | "sent"
>;

/** The statuses that settle a delivery: PostHog's final ones, or `expired`. */
export type PostHogEmailSettledStatus = Exclude<
  PostHogEmailDeliveryStatus,
  PostHogEmailProgressStatus
>;

/** What a poll learned of a delivery it did not settle. */
export interface PostHogEmailDeliveryPollRecord {
  readonly messageId: EmailDeliveryId;
  /** PostHog's progress status, when the read returned one. */
  readonly status?: PostHogEmailProgressStatus;
  readonly statusAt?: Temporal.Instant | null;
  readonly pollCount: number;
  readonly nextPollAt: Temporal.Instant;
}

/** The final status of a delivery, or why the poll gave up on it. */
export interface PostHogEmailDeliverySettlement {
  readonly messageId: EmailDeliveryId;
  readonly status: PostHogEmailSettledStatus;
  readonly reason: string | null;
  readonly statusAt: Temporal.Instant | null;
  readonly now: Temporal.Instant;
}

export interface IPostHogEmailDeliveryRepository {
  /**
   * Expires every unsettled delivery whose status PostHog no longer keeps,
   * so no poll claims or reads it. Returns how many it expired.
   */
  readonly expireRetentionEnded: (
    now: Temporal.Instant
  ) => Effect.Effect<number, EffectDrizzleQueryError>;
  /**
   * Marks the deliveries a poll reads now as polled and returns them, oldest
   * next poll first. Concurrent claims never return the same delivery. The
   * per-minute read budget counts deliveries whose last read falls in the
   * minute, as committed before this claim: claims running at the same
   * moment, and a signal rereading a delivery after 30 seconds, can exceed
   * it, which PostHog's rate limit then stops.
   */
  readonly claim: (request: {
    readonly trigger: PostHogEmailDeliveryPollTrigger;
    readonly now: Temporal.Instant;
  }) => Effect.Effect<
    readonly PostHogEmailDeliveryClaim[],
    EffectDrizzleQueryError
  >;
  /**
   * Stores a poll that settled nothing: the progress status PostHog
   * reported, if any, and when to poll again.
   */
  readonly recordPoll: (
    record: PostHogEmailDeliveryPollRecord
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  /** Settles a still unsettled delivery with its final status. */
  readonly settle: (
    settlement: PostHogEmailDeliverySettlement
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  /** Deletes deliveries settled long enough ago. Returns how many. */
  readonly deleteSettled: (
    now: Temporal.Instant
  ) => Effect.Effect<number, EffectDrizzleQueryError>;
}

/** Most deliveries one poll claims. */
const claimLimit = 100;
/** Most status reads all polls together make in a minute. */
const readsPerMinute = 500;
const readBudgetWindow = { seconds: 60 } as const;
/**
 * A delivery read this recently stays unclaimed, so a poll never rereads
 * what a concurrent poll just claimed. Backoff is at least a minute, so it
 * never hides a rescheduled delivery from a scheduled poll.
 */
const rereadGuard = { seconds: 30 } as const;
/** How long PostHog keeps a sent email's status, and settled rows stay. */
const retention = { hours: 30 * 24 } as const;

export class PostHogEmailDeliveryRepository extends Context.Service<
  PostHogEmailDeliveryRepository,
  IPostHogEmailDeliveryRepository
>()("@deskohub-workspace/email/PostHogEmailDeliveryRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const claim = Effect.fn("PostHogEmailDeliveryRepository.claim")(
        function* ({
          trigger,
          now,
        }: Parameters<IPostHogEmailDeliveryRepository["claim"]>[0]) {
          const notReadRecently = or(
            isNull(postHogEmailDeliveries.lastPolledAt),
            lte(postHogEmailDeliveries.lastPolledAt, now.subtract(rereadGuard))
          );
          const candidates = db
            .select({
              messageId: postHogEmailDeliveries.messageId,
              nextPollAt: postHogEmailDeliveries.nextPollAt,
            })
            .from(postHogEmailDeliveries)
            .where(
              and(
                isNull(postHogEmailDeliveries.settledAt),
                notReadRecently,
                trigger === "schedule"
                  ? lte(postHogEmailDeliveries.nextPollAt, now)
                  : undefined
              )
            )
            .orderBy(
              asc(postHogEmailDeliveries.nextPollAt),
              asc(postHogEmailDeliveries.messageId)
            )
            .limit(claimLimit)
            .for("update", { skipLocked: true })
            .as("candidates");
          // Drizzle's limit takes no SQL expression, so the budget cuts the
          // locked candidates by rank. Candidates past the budget stay locked
          // only until this statement commits.
          const ranked = db
            .select({
              messageId: candidates.messageId,
              rank: sql<number>`row_number() over (order by ${candidates.nextPollAt}, ${candidates.messageId})`.as(
                "rank"
              ),
            })
            .from(candidates)
            .as("ranked");
          const recentReads = db
            .select({ reads: count() })
            .from(postHogEmailDeliveries)
            .where(
              gt(
                postHogEmailDeliveries.lastPolledAt,
                now.subtract(readBudgetWindow)
              )
            );
          const claimed = yield* db
            .update(postHogEmailDeliveries)
            .set({ lastPolledAt: now })
            .where(
              inArray(
                postHogEmailDeliveries.messageId,
                db
                  .select({ messageId: ranked.messageId })
                  .from(ranked)
                  .where(
                    lte(ranked.rank, sql`${readsPerMinute} - (${recentReads})`)
                  )
              )
            )
            .returning({
              messageId: postHogEmailDeliveries.messageId,
              tags: postHogEmailDeliveries.tags,
              status: postHogEmailDeliveries.status,
              sentAt: postHogEmailDeliveries.sentAt,
              nextPollAt: postHogEmailDeliveries.nextPollAt,
              pollCount: postHogEmailDeliveries.pollCount,
            });
          return claimed.toSorted(
            (left, right) =>
              Temporal.Instant.compare(left.nextPollAt, right.nextPollAt) ||
              left.messageId.localeCompare(right.messageId)
          );
        }
      );

      const expireRetentionEnded = Effect.fn(
        "PostHogEmailDeliveryRepository.expireRetentionEnded"
      )((now: Temporal.Instant) =>
        db
          .update(postHogEmailDeliveries)
          .set({
            status: "expired",
            reason: "status-retention-ended",
            settledAt: now,
          })
          .where(
            and(
              isNull(postHogEmailDeliveries.settledAt),
              lte(postHogEmailDeliveries.sentAt, now.subtract(retention))
            )
          )
          .returning({ messageId: postHogEmailDeliveries.messageId })
          .pipe(Effect.map((rows) => rows.length))
      );

      const recordPoll = Effect.fn("PostHogEmailDeliveryRepository.recordPoll")(
        ({ messageId, ...progress }: PostHogEmailDeliveryPollRecord) =>
          db
            .update(postHogEmailDeliveries)
            .set(progress)
            .where(unsettled(messageId))
            .pipe(Effect.asVoid)
      );

      const settle = Effect.fn("PostHogEmailDeliveryRepository.settle")(
        ({
          messageId,
          status,
          reason,
          statusAt,
          now,
        }: PostHogEmailDeliverySettlement) =>
          db
            .update(postHogEmailDeliveries)
            .set({ status, reason, statusAt, settledAt: now })
            .where(unsettled(messageId))
            .pipe(Effect.asVoid)
      );

      const deleteSettled = Effect.fn(
        "PostHogEmailDeliveryRepository.deleteSettled"
      )((now: Temporal.Instant) =>
        db
          .delete(postHogEmailDeliveries)
          .where(
            and(
              isNotNull(postHogEmailDeliveries.settledAt),
              lte(postHogEmailDeliveries.settledAt, now.subtract(retention))
            )
          )
          .returning({ messageId: postHogEmailDeliveries.messageId })
          .pipe(Effect.map((rows) => rows.length))
      );

      return {
        expireRetentionEnded,
        claim,
        recordPoll,
        settle,
        deleteSettled,
      };
    })
  );
}

const unsettled = (messageId: EmailDeliveryId): SQL | undefined =>
  and(
    eq(postHogEmailDeliveries.messageId, messageId),
    isNull(postHogEmailDeliveries.settledAt)
  );
