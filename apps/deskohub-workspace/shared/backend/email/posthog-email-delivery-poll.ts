import "server-only";

import type { EmailDeliveryId } from "@deskohub/email";
import { Data, Effect, Match, Option, Ref } from "effect";
import { currentInstant } from "@/shared/utils/temporal";
import type {
  DeliveryReportError,
  DeliveryReportOutcome,
  DeliveryRequestError,
} from "./delivery-reports";
import {
  isPostHogEmailFinalStatus,
  type PostHogEmailFinalStatus,
} from "./posthog-delivery-report";
import {
  type PostHogEmailDeliveryClaim,
  PostHogEmailDeliveryRepository,
  type PostHogEmailDeliverySettlement,
  type PostHogEmailProgressStatus,
} from "./posthog-email-deliveries.repository";
import type {
  PostHogEmailDeliveryPollStop,
  PostHogEmailDeliveryPollSummary,
  PostHogEmailDeliveryPollTrigger,
} from "./posthog-email-delivery-polling";
import type {
  PostHogEmailStatusError,
  PostHogEmailStatusLookup,
} from "./posthog-email-status-client";

/** Reads PostHog's status of one tracked email. */
type PostHogEmailStatusRead = (
  messageId: EmailDeliveryId
) => Effect.Effect<PostHogEmailStatusLookup, PostHogEmailStatusError>;

/** Hands PostHog's final status of one email to its delivery-report handler. */
type PostHogFinalStatusReport = (delivery: {
  readonly messageId: EmailDeliveryId;
  readonly status: PostHogEmailFinalStatus;
  readonly statusAt: Temporal.Instant | null;
  readonly tags: Readonly<Record<string, string>>;
  readonly polledAt: Temporal.Instant;
}) => Effect.Effect<
  DeliveryReportOutcome,
  DeliveryRequestError | DeliveryReportError
>;

/** Status reads one poll keeps in flight. */
const readConcurrency = 10;
/** Minutes to a delivery's next read by its earlier reads; the last repeats. */
const backoffMinutes = [1, 2, 5, 15] as const;
/** How long after sending a poll waits for PostHog to know an email. */
const notFoundLimit = { hours: 24 } as const;

/**
 * Reads PostHog's status of the pending deliveries due now, stores their
 * progress and reports their final statuses; without a status reader, does
 * nothing. Logs one summary line.
 */
export const pollPostHogEmailDeliveries = Effect.fn(
  "PostHogEmailDeliveryPolling.poll"
)(
  ({
    trigger,
    read,
    report,
  }: {
    readonly trigger: PostHogEmailDeliveryPollTrigger;
    /** None when this deployment has no PostHog email secret key. */
    readonly read: Option.Option<PostHogEmailStatusRead>;
    readonly report: PostHogFinalStatusReport;
  }) =>
    Option.match(read, {
      onNone: () =>
        Effect.succeed<PostHogEmailDeliveryPollSummary>({
          outcome: "not-configured",
        }),
      onSome: (configuredRead) =>
        pollDueDeliveries({ trigger, read: configuredRead, report }),
    }).pipe(
      Effect.tap((summary) =>
        Effect.logInfo("PostHog email delivery poll").pipe(
          Effect.annotateLogs({ ...summary })
        )
      )
    )
);

/** What one poll did with a delivery it claimed. */
type DeliveryPollOutcome = "unread" | "pending" | "settled" | "expired";

const pollDueDeliveries = ({
  trigger,
  read,
  report,
}: {
  readonly trigger: PostHogEmailDeliveryPollTrigger;
  readonly read: PostHogEmailStatusRead;
  readonly report: PostHogFinalStatusReport;
}) =>
  Effect.Do.pipe(
    Effect.bind("repository", () =>
      Effect.service(PostHogEmailDeliveryRepository)
    ),
    Effect.bind("now", () => currentInstant),
    Effect.bind("retentionEnded", ({ repository, now }) =>
      repository.expireRetentionEnded(now)
    ),
    Effect.bind("claims", ({ repository, now }) =>
      repository.claim({ trigger, now })
    ),
    Effect.bind("stop", () =>
      Ref.make(Option.none<PostHogEmailDeliveryPollStop>())
    ),
    Effect.bind("outcomes", ({ claims, now, stop }) =>
      Effect.forEach(
        claims,
        (claim) => pollDelivery({ claim, now, stop, read, report }),
        { concurrency: readConcurrency }
      )
    ),
    Effect.tap(({ repository, now }) =>
      repository
        .deleteSettled(now)
        .pipe(Effect.when(Effect.succeed(trigger === "schedule")))
    ),
    Effect.bind("stoppedBy", ({ stop }) => Ref.get(stop)),
    Effect.map(
      ({
        retentionEnded,
        outcomes,
        stoppedBy,
      }): PostHogEmailDeliveryPollSummary => ({
        outcome: "polled",
        trigger,
        polled: outcomes.filter((outcome) => outcome !== "unread").length,
        settled: outcomes.filter((outcome) => outcome === "settled").length,
        expired:
          retentionEnded +
          outcomes.filter((outcome) => outcome === "expired").length,
        ...Option.match(stoppedBy, {
          onNone: () => ({}),
          onSome: (stoppedBy) => ({ stoppedBy }),
        }),
      })
    )
  );

/** One claimed delivery within a poll. */
interface DeliveryPoll {
  readonly claim: PostHogEmailDeliveryClaim;
  readonly now: Temporal.Instant;
  /** Set once PostHog refuses further reads in this poll. */
  readonly stop: Ref.Ref<Option.Option<PostHogEmailDeliveryPollStop>>;
  readonly read: PostHogEmailStatusRead;
  readonly report: PostHogFinalStatusReport;
}

/** Reads one delivery's status and acts on it, unless the poll has stopped. */
const pollDelivery = (delivery: DeliveryPoll) =>
  Ref.get(delivery.stop).pipe(
    Effect.flatMap(
      Option.match({
        onSome: () => Effect.succeed<DeliveryPollOutcome>("unread"),
        onNone: () =>
          delivery.read(delivery.claim.messageId).pipe(
            Effect.match({
              onSuccess: (lookup) => lookupStep(delivery, lookup),
              onFailure: readErrorStep,
            }),
            Effect.flatMap((step) => applyStep(delivery, step))
          ),
      })
    )
  );

/** What a poll does with a delivery after reading its status. */
type DeliveryStep = Data.TaggedEnum<{
  Reschedule: {
    readonly status?: PostHogEmailProgressStatus;
    readonly statusAt?: Temporal.Instant | null;
  };
  Report: {
    readonly status: PostHogEmailFinalStatus;
    readonly statusAt: Temporal.Instant | null;
    readonly reason: string | null;
  };
  Expire: { readonly reason: "not-found" | "rejected" };
  Stop: { readonly reason: PostHogEmailDeliveryPollStop };
}>;
const DeliveryStep = Data.taggedEnum<DeliveryStep>();

const lookupStep = (
  { claim, now }: DeliveryPoll,
  lookup: PostHogEmailStatusLookup
): DeliveryStep =>
  Match.valueTags(lookup, {
    NotFoundYet: () =>
      Temporal.Instant.compare(claim.sentAt, now.subtract(notFoundLimit)) <= 0
        ? DeliveryStep.Expire({ reason: "not-found" })
        : DeliveryStep.Reschedule({}),
    Found: ({ report: { status, statusAt: statusDate, reason } }) => {
      const statusAt =
        statusDate === null
          ? null
          : Temporal.Instant.fromEpochMilliseconds(statusDate.getTime());
      return isPostHogEmailFinalStatus(status)
        ? DeliveryStep.Report({ status, statusAt, reason })
        : DeliveryStep.Reschedule({ status, statusAt });
    },
  });

const readErrorStep = (error: PostHogEmailStatusError): DeliveryStep =>
  Match.value(error.reason).pipe(
    Match.whenOr("rate-limited", "unauthorized", (reason) =>
      DeliveryStep.Stop({ reason })
    ),
    Match.when("rejected", () => DeliveryStep.Expire({ reason: "rejected" })),
    Match.whenOr("unavailable", "invalid-response", () =>
      DeliveryStep.Reschedule({})
    ),
    Match.exhaustive
  );

const applyStep = (delivery: DeliveryPoll, step: DeliveryStep) =>
  DeliveryStep.$match(step, {
    Reschedule: ({ _tag, ...progress }) => reschedule(delivery, progress),
    Report: (final) => reportFinalStatus(delivery, final),
    Expire: ({ reason }) =>
      settle({
        messageId: delivery.claim.messageId,
        status: "expired",
        reason,
        statusAt: null,
        now: delivery.now,
      }).pipe(Effect.as<DeliveryPollOutcome>("expired")),
    Stop: ({ reason }) => stopPoll(delivery, reason),
  });

/** Stores what the read learned and when to read the delivery again. */
const reschedule = (
  { claim, now }: DeliveryPoll,
  progress: {
    readonly status?: PostHogEmailProgressStatus;
    readonly statusAt?: Temporal.Instant | null;
  }
) =>
  Effect.service(PostHogEmailDeliveryRepository).pipe(
    Effect.flatMap((repository) =>
      repository.recordPoll({
        messageId: claim.messageId,
        ...progress,
        pollCount: claim.pollCount + 1,
        nextPollAt: now.add({
          minutes:
            backoffMinutes[
              Math.min(claim.pollCount, backoffMinutes.length - 1)
            ],
        }),
      })
    ),
    Effect.as<DeliveryPollOutcome>("pending")
  );

const settle = (settlement: PostHogEmailDeliverySettlement) =>
  Effect.service(PostHogEmailDeliveryRepository).pipe(
    Effect.flatMap((repository) => repository.settle(settlement))
  );

/**
 * Reports a final status and settles the delivery, or keeps it pending for
 * a later poll when its handler fails.
 */
const reportFinalStatus = (
  delivery: DeliveryPoll,
  final: Data.TaggedEnum.Value<DeliveryStep, "Report">
) => {
  const { claim, now } = delivery;
  return delivery
    .report({
      messageId: claim.messageId,
      status: final.status,
      statusAt: final.statusAt,
      tags: claim.tags,
      polledAt: now,
    })
    .pipe(
      Effect.matchEffect({
        onSuccess: () =>
          settle({
            messageId: claim.messageId,
            status: final.status,
            reason: final.reason,
            statusAt: final.statusAt,
            now,
          }).pipe(Effect.as<DeliveryPollOutcome>("settled")),
        onFailure: (error) =>
          Effect.logWarning(
            "PostHog email delivery report failed; polling it again later"
          ).pipe(
            Effect.annotateLogs({
              messageId: claim.messageId,
              errorCode: error.errorCode,
            }),
            Effect.andThen(reschedule(delivery, {}))
          ),
      })
    );
};

/**
 * Stops the poll's further reads; the first refusal names the stop. The
 * delivery stays due, like every delivery the poll leaves unread.
 */
const stopPoll = (
  { claim, stop }: DeliveryPoll,
  reason: PostHogEmailDeliveryPollStop
) =>
  Ref.update(
    stop,
    Option.orElse(() => Option.some(reason))
  ).pipe(
    Effect.andThen(
      Effect.logError(
        "PostHog refused the email secret key; polling stopped"
      ).pipe(
        Effect.annotateLogs({ messageId: claim.messageId, reason }),
        Effect.when(Effect.succeed(reason === "unauthorized"))
      )
    ),
    Effect.as<DeliveryPollOutcome>("pending")
  );
