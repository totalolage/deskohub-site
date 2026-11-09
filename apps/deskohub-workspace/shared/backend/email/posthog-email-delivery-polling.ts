import "server-only";

import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { env } from "@/env";
import {
  DeliveryReportHandlersLive,
  deliveryReportHandlers,
} from "./delivery-report-handlers";
import {
  type DeliveryReportHandler,
  dispatchDeliveryReport,
} from "./delivery-reports";
import { postHogDeliveryReport } from "./posthog-delivery-report";
import { PostHogEmailDeliveryRepository } from "./posthog-email-deliveries.repository";
import { pollPostHogEmailDeliveries } from "./posthog-email-delivery-poll";
import { PostHogEmailStatusReader } from "./posthog-email-status-reader";

/**
 * What asked for a poll: the PostHog webhook's signal that some email's
 * status changed, or the scheduled safety-net sweep.
 */
export type PostHogEmailDeliveryPollTrigger = "signal" | "schedule";

/** Why a poll stopped before reading every message it claimed. */
export type PostHogEmailDeliveryPollStop = "rate-limited" | "unauthorized";

/** The result of one poll of pending PostHog email deliveries. */
export type PostHogEmailDeliveryPollSummary =
  | { readonly outcome: "not-configured" }
  | {
      readonly outcome: "polled";
      readonly trigger: PostHogEmailDeliveryPollTrigger;
      /** Status reads made against PostHog. */
      readonly polled: number;
      /** Messages that reached a final status and were reported. */
      readonly settled: number;
      /** Messages given up on without a final status. */
      readonly expired: number;
      readonly stoppedBy?: PostHogEmailDeliveryPollStop;
    };

/**
 * Reads PostHog's status of pending PostHog email deliveries and reports
 * final statuses to the delivery-report handlers.
 */
export class PostHogEmailDeliveryPolling extends Context.Service<
  PostHogEmailDeliveryPolling,
  {
    readonly poll: (
      trigger: PostHogEmailDeliveryPollTrigger
    ) => Effect.Effect<
      PostHogEmailDeliveryPollSummary,
      EffectDrizzleQueryError
    >;
  }
>()("@deskohub/workspace/PostHogEmailDeliveryPolling") {
  /**
   * Polls with the deployment's PostHog status reader and delivery
   * repository, reporting final statuses to `handlers` as reports of
   * `deploymentEnvironment`.
   */
  static reportingTo = <R>(
    handlers: readonly DeliveryReportHandler<R>[],
    deploymentEnvironment: string
  ) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const { read } = yield* PostHogEmailStatusReader;
        const repository = yield* PostHogEmailDeliveryRepository;
        const handlerContext = yield* Effect.context<R>();
        return {
          poll: (trigger) =>
            pollPostHogEmailDeliveries({
              trigger,
              read,
              report: (delivery) =>
                dispatchDeliveryReport(
                  postHogDeliveryReport({ ...delivery, deploymentEnvironment }),
                  handlers
                ).pipe(Effect.provideContext(handlerContext)),
            }).pipe(
              Effect.provideService(PostHogEmailDeliveryRepository, repository)
            ),
        };
      })
    );

  /** Reads the deployment environment when built, like the Resend webhook. */
  static Live: Layer.Layer<PostHogEmailDeliveryPolling> = Layer.unwrap(
    Effect.sync(() => this.reportingTo(deliveryReportHandlers, env.VERCEL_ENV))
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        PostHogEmailDeliveryRepository.Default.pipe(
          Layer.provide(WorkspaceDatabase.Default)
        ),
        DeliveryReportHandlersLive,
        PostHogEmailStatusReader.Live
      )
    )
  );
}
