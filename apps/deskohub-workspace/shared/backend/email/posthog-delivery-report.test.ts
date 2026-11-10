import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Effect, Layer, Option, Schema } from "effect";
import { customerAccessDeliveryReports } from "@/features/checkout/backend/fulfillment/reservation-delivery-reports";
import {
  type ReservationAccessDeliveryReport,
  type ReservationDeliveryOutcome,
  ReservationFulfillment,
} from "@/features/checkout/backend/fulfillment/reservation-fulfillment.service";
import { campaignDeliveryReports } from "@/features/email-campaigns/backend/campaign-delivery-reports";
import {
  CampaignDeliveryStatusService,
  type ICampaignDeliveryStatusService,
} from "@/features/email-campaigns/backend/campaign-delivery-status.service";
import {
  type DeliveryReport,
  type DeliveryReportEvent,
  deliveryReportHandler,
  dispatchDeliveryReport,
  ingestDeliveryReport,
  processedDeliveryReport,
} from "./delivery-reports";
import {
  resendEmailEvent,
  restoreRealResendModule,
  signedResendWebhookRequest,
  syntheticWebhookSecret,
} from "./delivery-reports.test-utils";
import type { EmailKind } from "./email-kind";
import {
  isPostHogEmailFinalStatus,
  type PostHogEmailFinalStatus,
  postHogDeliveryReport,
} from "./posthog-delivery-report";
import { ResendWebhookConfig } from "./resend-webhook.config";

await restoreRealResendModule();

const messageId = EmailDeliveryIdSchema.make("posthog-message-id");
const deploymentEnvironment = "production";
const statusAt = Temporal.Instant.from("2026-01-01T12:05:00.000Z");
const polledAt = Temporal.Instant.from("2026-01-01T12:20:00.000Z");

const campaignTags = {
  category: "email-campaign",
  campaignSendId: "campaign-send-id",
  dotyposCustomerId: "dotypos-customer-id",
  deploymentEnvironment,
};

describe("postHogDeliveryReport", () => {
  test("reports PostHog's final status as the provider event at its status time", () => {
    expect(
      postHogDeliveryReport({
        messageId,
        status: "bounced",
        statusAt,
        tags: campaignTags,
        polledAt,
        deploymentEnvironment,
      })
    ).toEqual({
      eventId: "posthog:posthog-message-id:bounced",
      event: "email.bounced",
      emailId: "posthog-message-id",
      occurredAt: statusAt,
      tags: new Map(Object.entries(campaignTags)),
      deploymentEnvironment,
    } as never);
  });

  test("dates a status PostHog gave no time by the poll that read it", () => {
    const report = postHogDeliveryReport({
      messageId,
      status: "delivered",
      statusAt: null,
      tags: campaignTags,
      polledAt,
      deploymentEnvironment,
    });

    expect(report.occurredAt).toEqual(polledAt);
  });

  test("gives every read of the same final status the same event ID", () => {
    const report = (status: PostHogEmailFinalStatus, at: Temporal.Instant) =>
      postHogDeliveryReport({
        messageId,
        status,
        statusAt: null,
        tags: {},
        polledAt: at,
        deploymentEnvironment,
      });

    expect(report("delivered", polledAt).eventId).toBe(
      report("delivered", statusAt).eventId
    );
    expect(report("delivered", polledAt).eventId).not.toBe(
      report("complained", polledAt).eventId
    );
  });

  test("treats only statuses PostHog no longer changes as final", () => {
    expect(
      (
        [
          "queued",
          "sent",
          "delivered",
          "failed",
          "bounced",
          "complained",
        ] as const
      ).filter(isPostHogEmailFinalStatus)
    ).toEqual(["delivered", "failed", "bounced", "complained"]);
  });
});

const noteMetadata = Schema.Struct({ noteId: Schema.NonEmptyString });
const noteKind: EmailKind<typeof noteMetadata.Type> = {
  category: "test-note",
  metadata: Schema.toStandardSchemaV1(noteMetadata),
};

type NoteReport = DeliveryReport<typeof noteMetadata.Type, DeliveryReportEvent>;

/**
 * The real handlers of access and campaign emails over recording services,
 * and a test kind's handler recording each report it is handed.
 */
const recordingHandlers = () => {
  const noteReports: NoteReport[] = [];
  const recordDelivery = mock((_report: ReservationAccessDeliveryReport) =>
    Effect.succeed<ReservationDeliveryOutcome>("applied")
  );
  const record = mock<ICampaignDeliveryStatusService["record"]>(() =>
    Effect.succeed(processedDeliveryReport)
  );
  return {
    handlers: [
      customerAccessDeliveryReports,
      campaignDeliveryReports,
      deliveryReportHandler(
        noteKind,
        [
          "email.delivered",
          "email.failed",
          "email.bounced",
          "email.complained",
        ],
        (report) =>
          Effect.sync(() => {
            noteReports.push(report);
            return processedDeliveryReport;
          })
      ),
    ],
    services: Layer.mergeAll(
      Layer.mock(ReservationFulfillment, { recordDelivery }),
      Layer.mock(CampaignDeliveryStatusService, { record })
    ),
    calls: () => ({
      noteReports,
      recordDelivery: recordDelivery.mock.calls,
      record: record.mock.calls,
    }),
  };
};

const webhookSecret = syntheticWebhookSecret();

const viaResendWebhook = async (
  status: PostHogEmailFinalStatus,
  tags: Readonly<Record<string, string>>
) => {
  const recording = recordingHandlers();
  const { request } = signedResendWebhookRequest({
    secret: webhookSecret,
    payload: resendEmailEvent({
      type: `email.${status}`,
      emailId: messageId,
      tags,
      createdAt: statusAt.toString(),
    }),
  });
  const outcome = await Effect.runPromise(
    ingestDeliveryReport(request, recording.handlers).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ResendWebhookConfig, {
            apiKey: "re_test",
            deploymentEnvironment,
            webhookSecret,
          }),
          recording.services
        )
      )
    )
  );
  return { outcome, calls: recording.calls() };
};

const viaPostHogPoll = async (
  status: PostHogEmailFinalStatus,
  tags: Readonly<Record<string, string>>
) => {
  const recording = recordingHandlers();
  const outcome = await Effect.runPromise(
    dispatchDeliveryReport(
      postHogDeliveryReport({
        messageId,
        status,
        statusAt,
        tags,
        polledAt,
        deploymentEnvironment,
      }),
      recording.handlers
    ).pipe(Effect.provide(recording.services))
  );
  return { outcome, calls: recording.calls() };
};

const accessTags = {
  source: "workspace-paid-fulfillment",
  category: "workspace-paid-reservation-access",
  deploymentEnvironment,
  workspaceReservationId: "reservation-id",
  dotyposReservationId: "dotypos-reservation-id",
  dotyposCustomerId: "dotypos-customer-id",
};
const noteTags = {
  category: "test-note",
  deploymentEnvironment,
  noteId: "note-1",
};

const parityCases: readonly (readonly [
  email: string,
  tags: Readonly<Record<string, string>>,
  status: PostHogEmailFinalStatus,
  handledCalls: number,
])[] = [
  ["an access email", accessTags, "delivered", 1],
  ["an access email", accessTags, "failed", 1],
  ["an access email", accessTags, "bounced", 1],
  ["an access email", accessTags, "complained", 0],
  ["a campaign email", campaignTags, "delivered", 1],
  ["a campaign email", campaignTags, "failed", 1],
  ["a campaign email", campaignTags, "bounced", 1],
  ["a campaign email", campaignTags, "complained", 1],
  ["a test-kind email", noteTags, "delivered", 1],
  ["a test-kind email", noteTags, "failed", 1],
  ["a test-kind email", noteTags, "bounced", 1],
  ["a test-kind email", noteTags, "complained", 1],
  [
    "another deployment's campaign email",
    { ...campaignTags, deploymentEnvironment: "preview" },
    "delivered",
    0,
  ],
  [
    "a campaign email without its metadata",
    { category: "email-campaign", deploymentEnvironment },
    "bounced",
    1,
  ],
];

describe("PostHog delivery reports", () => {
  test.each(parityCases)(
    "reach the handlers of %s as Resend's signed %p report does",
    async (_, tags, status, handledCalls) => {
      const resend = await viaResendWebhook(status, tags);
      const postHog = await viaPostHogPoll(status, tags);

      const { noteReports, recordDelivery, record } = resend.calls;
      expect(noteReports.length + recordDelivery.length + record.length).toBe(
        handledCalls
      );
      expect(postHog).toEqual(resend);
    }
  );

  test("hand a kind's handler the decoded report of PostHog's status", async () => {
    const { calls } = await viaPostHogPoll("failed", noteTags);

    expect(calls.noteReports).toEqual([
      {
        emailId: "posthog-message-id",
        event: "email.failed",
        occurredAt: statusAt,
        metadata: Option.some({ noteId: "note-1" }),
      } as never,
    ]);
  });
});
