import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Option, Schema } from "effect";
import {
  type DeliveryReport,
  DeliveryReportError,
  type DeliveryReportEvent,
  type DeliveryReportHandler,
  deliveryReportHandler,
  deliveryReportHandlerOwningIgnores,
  ingestDeliveryReport,
  processedDeliveryReport,
  type UnfilteredDeliveryReport,
} from "./delivery-reports";
import {
  resendEmailEvent,
  restoreRealResendModule,
  signedResendWebhookRequest,
  spanNameRecorder,
  syntheticWebhookSecret,
} from "./delivery-reports.test-utils";
import type { EmailKind } from "./email-kind";
import { ResendWebhookConfig } from "./resend-webhook.config";

await restoreRealResendModule();

const webhookSecret = syntheticWebhookSecret();
const config = {
  apiKey: "re_test",
  deploymentEnvironment: "preview",
  webhookSecret,
};

const noteMetadata = Schema.Struct({ noteId: Schema.NonEmptyString });
const noteKind: EmailKind<typeof noteMetadata.Type> = {
  category: "test-note",
  metadata: Schema.toStandardSchemaV1(noteMetadata),
};
const receiptKind: EmailKind<typeof noteMetadata.Type> = {
  category: "test-receipt",
  metadata: Schema.toStandardSchemaV1(noteMetadata),
};

type RecordedReport = DeliveryReport<
  typeof noteMetadata.Type,
  DeliveryReportEvent
>;
let noteReports: RecordedReport[];
let receiptReports: RecordedReport[];

const recordingHandler = (
  kind: EmailKind<typeof noteMetadata.Type>,
  events: readonly DeliveryReportEvent[],
  reports: () => RecordedReport[]
) =>
  deliveryReportHandler(kind, events, (report) =>
    Effect.sync(() => {
      reports().push(report);
      return processedDeliveryReport;
    })
  );

const handlers = [
  recordingHandler(
    noteKind,
    ["email.delivered", "email.bounced"],
    () => noteReports
  ),
  recordingHandler(receiptKind, ["email.complained"], () => receiptReports),
];

beforeEach(() => {
  noteReports = [];
  receiptReports = [];
});

const noteTags = (overrides: Record<string, string | undefined> = {}) =>
  Object.entries({
    category: "test-note",
    deploymentEnvironment: "preview",
    noteId: "note-1",
    ...overrides,
  }).flatMap(([name, value]) => (value === undefined ? [] : [{ name, value }]));

const ingest = (
  request: Request,
  input: {
    readonly handlers?: readonly DeliveryReportHandler<never>[];
    readonly config?: Partial<typeof config>;
  } = {}
) =>
  ingestDeliveryReport(request, input.handlers ?? handlers).pipe(
    Effect.provide(
      Layer.succeed(ResendWebhookConfig, { ...config, ...input.config })
    )
  );

const ingestSigned = (payload: string) =>
  Effect.runPromise(
    ingest(
      signedResendWebhookRequest({ secret: webhookSecret, payload }).request
    )
  );

const ingestError = (
  request: Request,
  input: Parameters<typeof ingest>[1] = {}
) => Effect.runPromise(Effect.flip(ingest(request, input)));

const deliveredNote = resendEmailEvent({
  type: "email.delivered",
  emailId: "email-1",
  tags: noteTags(),
});

describe("ingestDeliveryReport request verification", () => {
  test("hands a signed report to the handler of its kind", async () => {
    expect(await ingestSigned(deliveredNote)).toEqual({ status: "processed" });

    expect(noteReports).toEqual([
      {
        emailId: "email-1",
        event: "email.delivered",
        occurredAt: Temporal.Instant.from("2026-01-01T12:05:00.000Z"),
        metadata: Option.some({ noteId: "note-1" }),
      } as never,
    ]);
    expect(receiptReports).toEqual([]);
  });

  test("rejects a report whose Svix signature does not verify", async () => {
    const { request, eventId } = signedResendWebhookRequest({
      secret: webhookSecret,
      payload: deliveredNote,
      signature: "v1,",
    });

    expect(await ingestError(request)).toMatchObject({
      _tag: "DeliveryRequestError",
      errorCode: "resend_webhook_verification_failed",
      eventId,
    });
    expect(noteReports).toEqual([]);
  });

  test("rejects a report signed with another secret", async () => {
    const { request } = signedResendWebhookRequest({
      secret: syntheticWebhookSecret(),
      payload: deliveredNote,
    });

    expect(await ingestError(request)).toMatchObject({
      errorCode: "resend_webhook_verification_failed",
    });
  });

  test("rejects a request without Svix headers", async () => {
    const { request } = signedResendWebhookRequest({
      secret: webhookSecret,
      payload: deliveredNote,
      headers: { "content-type": "application/json" },
    });

    expect(await ingestError(request)).toMatchObject({
      _tag: "DeliveryRequestError",
      errorCode: "resend_webhook_headers_missing",
    });
  });

  test("rejects an empty request body", async () => {
    const { request, eventId } = signedResendWebhookRequest({
      secret: webhookSecret,
      payload: "",
    });

    expect(await ingestError(request)).toMatchObject({
      errorCode: "resend_webhook_payload_invalid",
      eventId,
    });
  });

  test.each([
    ["webhook secret", { webhookSecret: "" }, "resend_webhook_secret_missing"],
    ["API key", { apiKey: undefined }, "resend_webhook_api_key_missing"],
  ] as const)(
    "fails without a configured %s",
    async (_, missing, errorCode) => {
      const { request, eventId } = signedResendWebhookRequest({
        secret: webhookSecret,
        payload: deliveredNote,
      });

      expect(await ingestError(request, { config: missing })).toMatchObject({
        errorCode,
        eventId,
      });
    }
  );

  test("rejects a verified payload that is not a Resend event", async () => {
    const { request, eventId } = signedResendWebhookRequest({
      secret: webhookSecret,
      payload: JSON.stringify({ type: "email.delivered" }),
    });

    expect(await ingestError(request)).toMatchObject({
      errorCode: "resend_webhook_payload_invalid",
      eventId,
    });
  });
});

describe("ingestDeliveryReport dispatch", () => {
  test("reads tags sent as a name-to-value record", async () => {
    const payload = resendEmailEvent({
      type: "email.bounced",
      emailId: "email-1",
      tags: Object.fromEntries(
        noteTags().map(({ name, value }) => [name, value])
      ),
    });

    expect(await ingestSigned(payload)).toEqual({ status: "processed" });
    expect(noteReports.map((report) => report.event)).toEqual([
      "email.bounced",
    ]);
  });

  test("routes each report by its category", async () => {
    const payload = resendEmailEvent({
      type: "email.complained",
      emailId: "email-2",
      tags: noteTags({ category: "test-receipt" }),
    });

    expect(await ingestSigned(payload)).toEqual({ status: "processed" });
    expect(receiptReports.map((report) => report.emailId)).toEqual(["email-2"]);
    expect(noteReports).toEqual([]);
  });

  test.each([
    ["a kind without a handler", noteTags({ category: "test-other" })],
    ["an email without a category", noteTags({ category: undefined })],
  ])("ignores %s", async (_, tags) => {
    const payload = resendEmailEvent({
      type: "email.delivered",
      emailId: "email-1",
      tags,
    });

    expect(await ingestSigned(payload)).toEqual({
      status: "ignored",
      reason: "unhandled_email_kind",
    });
    expect(noteReports).toEqual([]);
  });

  test.each([
    ["another", "production", "deployment_environment_mismatch"],
    ["no", undefined, "deployment_environment_missing"],
  ] as const)(
    "ignores a report about %s deployment's email",
    async (_, deploymentEnvironment, reason) => {
      const payload = resendEmailEvent({
        type: "email.delivered",
        emailId: "email-1",
        tags: noteTags({ deploymentEnvironment }),
      });

      expect(await ingestSigned(payload)).toEqual({
        status: "ignored",
        reason,
      });
      expect(noteReports).toEqual([]);
    }
  );

  test.each(["email.sent", "email.opened", "email.complained"])(
    "ignores %s, which the kind's handler does not consume",
    async (type) => {
      const payload = resendEmailEvent({
        type,
        emailId: "email-1",
        tags: noteTags(),
      });

      expect(await ingestSigned(payload)).toEqual({
        status: "ignored",
        reason: "non_delivery_event",
      });
      expect(noteReports).toEqual([]);
    }
  );

  test("ignores an unconsumed event before it needs an email ID", async () => {
    const payload = resendEmailEvent({ type: "email.sent", tags: noteTags() });

    expect(await ingestSigned(payload)).toEqual({
      status: "ignored",
      reason: "non_delivery_event",
    });
  });

  test("rejects a consumed event without an email ID", async () => {
    const { request, eventId } = signedResendWebhookRequest({
      secret: webhookSecret,
      payload: resendEmailEvent({ type: "email.delivered", tags: noteTags() }),
    });

    expect(await ingestError(request)).toMatchObject({
      _tag: "DeliveryRequestError",
      errorCode: "resend_webhook_payload_invalid",
      eventId,
    });
    expect(noteReports).toEqual([]);
  });

  test.each([
    ["without the kind's metadata", noteTags({ noteId: undefined })],
    ["with invalid metadata", noteTags({ noteId: "" })],
  ])("hands over a report %s with none", async (_, tags) => {
    const payload = resendEmailEvent({
      type: "email.delivered",
      emailId: "email-1",
      tags,
    });

    expect(await ingestSigned(payload)).toEqual({ status: "processed" });
    expect(noteReports.map((report) => report.metadata)).toEqual([
      Option.none(),
    ]);
  });

  test("adds the event ID to a handler's error", async () => {
    const cause = new Error("synthetic handler failure");
    const failing = deliveryReportHandler(noteKind, ["email.delivered"], () =>
      Effect.fail(
        new DeliveryReportError({
          errorCode: "test_note_failed",
          message: "Note failed.",
          details: { noteId: "note-1" },
          cause,
        })
      )
    );
    const { request, eventId } = signedResendWebhookRequest({
      secret: webhookSecret,
      payload: deliveredNote,
    });

    expect(await ingestError(request, { handlers: [failing] })).toMatchObject({
      _tag: "DeliveryReportError",
      errorCode: "test_note_failed",
      message: "Note failed.",
      eventId,
      details: { noteId: "note-1" },
      cause,
    });
  });
});

describe("handlers owning their ignores", () => {
  const ownSpan = "test.processNote";
  let unfiltered: UnfilteredDeliveryReport<
    typeof noteMetadata.Type,
    "email.delivered"
  >[];
  beforeEach(() => {
    unfiltered = [];
  });

  const owningIgnores = deliveryReportHandlerOwningIgnores(
    noteKind,
    ["email.delivered"],
    ownSpan,
    (report) =>
      Effect.sync(() => {
        unfiltered.push(report);
        return processedDeliveryReport;
      })
  );

  const ingestTraced = (payload: string) => {
    const spans = spanNameRecorder();
    return Effect.runPromise(
      ingest(
        signedResendWebhookRequest({ secret: webhookSecret, payload }).request,
        { handlers: [owningIgnores] }
      ).pipe(
        Effect.withTracer(spans.tracer),
        Effect.map((outcome) => ({ outcome, spanNames: spans.names }))
      )
    );
  };

  test("hands over events outside the declared set and missing email IDs as none", async () => {
    await ingestTraced(
      resendEmailEvent({ type: "email.opened", tags: noteTags() })
    );

    expect(unfiltered).toEqual([
      {
        emailId: Option.none(),
        event: Option.none(),
        occurredAt: Temporal.Instant.from("2026-01-01T12:05:00.000Z"),
        metadata: Option.some({ noteId: "note-1" }),
      } as never,
    ]);
  });

  test("hands over a declared event with its email ID", async () => {
    await ingestTraced(deliveredNote);

    expect(
      unfiltered.map(({ emailId, event }) => ({ emailId, event }))
    ).toEqual([
      {
        emailId: Option.some("email-1"),
        event: Option.some("email.delivered"),
      },
    ] as never);
  });

  test("opens the handler's span before ignoring another deployment's report", async () => {
    const { outcome, spanNames } = await ingestTraced(
      resendEmailEvent({
        type: "email.delivered",
        emailId: "email-1",
        tags: noteTags({ deploymentEnvironment: "production" }),
      })
    );

    expect(outcome).toEqual({
      status: "ignored",
      reason: "deployment_environment_mismatch",
    });
    expect(spanNames).toContain(ownSpan);
    expect(unfiltered).toEqual([]);
  });

  test("leaves a filtered handler without a span of its own", async () => {
    const spans = spanNameRecorder();
    await Effect.runPromise(
      ingest(
        signedResendWebhookRequest({
          secret: webhookSecret,
          payload: deliveredNote,
        }).request
      ).pipe(Effect.withTracer(spans.tracer))
    );

    expect(spans.names).toEqual([
      "processResendWebhookRequest",
      "resendWebhook.processWebhook",
      "resendWebhook.processVerifiedEvent",
    ]);
  });
});
