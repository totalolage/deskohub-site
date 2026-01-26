import { Effect, Layer, Schema } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { DotyposService } from "@/features/dotypos";
import { parseNoteData } from "@/features/dotypos/utils/note-metadata";
import { StandaloneEmailServiceLive } from "@/features/email";
import { sendNewReservationNotification } from "@/features/email/backend/send-reservation-notification";
import {
  sendReservationConfirmedEmail,
  sendReservationCreatedEmail,
  sendReservationDeclinedEmail,
} from "@/features/email/backend/send-reservation-status-email";
import { getLocale, type Locale } from "@/features/i18n";
import type { WebhookResult, WebhookStatusChange } from "@/features/webhook";
import { DotyposConfig } from "@/shared/backend/config/dotypos.config";
import {
  validateWebhookUUID,
  WebhookValidationError,
} from "@/shared/backend/utils/webhook";
import { dotyposTags } from "@/shared/utils/cache-tags";

/**
 * Dotypos Reservation Status Codes
 */
enum DotyposReservationStatus {
  NEW = 0,
  CONFIRMED = 5,
  DECLINED = 10,
}

/**
 * Dotypos Reservation Webhook Payload Schema
 *
 * Using Effect Schema for robust validation and type safety
 */
const DotyposReservationPayloadItem = Schema.Struct({
  branchid: Schema.Number,
  created: Schema.Number,
  customerid: Schema.Number,
  employeeid: Schema.Number,
  flags: Schema.Number,
  deleted: Schema.Number,
  note: Schema.NullOr(Schema.String),
  seats: Schema.Union(Schema.Number, Schema.String),
  status: Schema.Number,
  tableid: Schema.Number,
  taglist: Schema.NullOr(Schema.String),
  versiondate: Schema.Number,
  reservationid: Schema.Number,
  startdate: Schema.Number,
  enddate: Schema.Number,
  cloudid: Schema.String,
});

// The webhook sends an array with a single item
const DotyposReservationPayload = Schema.NonEmptyArray(
  DotyposReservationPayloadItem
);

/**
 * Determine what type of update this is by comparing status
 */
const getStatusChangeType = (status: number): WebhookStatusChange => {
  switch (status) {
    case DotyposReservationStatus.NEW:
      return "created";
    case DotyposReservationStatus.CONFIRMED:
      return "confirmed";
    case DotyposReservationStatus.DECLINED:
      return "declined";
    default:
      return "unknown";
  }
};

/**
 * Process the webhook payload
 */
const processWebhook = Effect.fn("processWebhook")(
  function* (payload: unknown) {
    yield* Effect.log("Processing webhook");

    // Validate and parse the payload
    const validatedPayload = yield* Schema.decodeUnknown(
      DotyposReservationPayload
    )(payload).pipe(
      Effect.mapError(
        (error) =>
          new WebhookValidationError({
            message: "Invalid payload format",
            issues: error.message,
          })
      )
    );

    // Extract the first (and only) item
    const reservation = validatedPayload[0];

    // Determine the type of status change
    const statusChange = getStatusChangeType(reservation.status);

    // Skip if unknown status or deleted
    if (statusChange === "unknown" || reservation.deleted === 1) {
      return {
        skipped: true,
        message: "Webhook processed (no action taken)",
      };
    }

    const dotypos = yield* DotyposService;

    // Fetch full reservation and customer details from Dotypos
    const fullReservation = yield* dotypos.getReservation(
      String(reservation.reservationid)
    );

    // Parse the note to extract metadata including locale
    const parsedNote = parseNoteData(fullReservation.reservation.note);

    const locale: Locale = parsedNote?.locale || getLocale();

    // Send appropriate emails based on status change
    let emailSent = false;

    if (fullReservation.customer.email) {
      switch (statusChange) {
        case "created":
          // Send confirmation email to customer
          yield* sendReservationCreatedEmail(
            fullReservation.reservation,
            fullReservation.customer,
            locale
          );

          // Also send notification to business
          yield* sendNewReservationNotification(
            fullReservation.reservation,
            fullReservation.customer,
            locale
          );

          emailSent = true;
          break;

        case "confirmed":
          yield* sendReservationConfirmedEmail(
            fullReservation.reservation,
            fullReservation.customer,
            locale
          );
          emailSent = true;
          break;

        case "declined":
          yield* sendReservationDeclinedEmail(
            fullReservation.reservation,
            fullReservation.customer,
            locale
          );
          emailSent = true;
          break;
      }
    }

    // Invalidate cache for this reservation
    const reservationIdStr = String(reservation.reservationid);
    const customerIdStr = String(reservation.customerid);

    // Revalidate all related cache tags
    const tagsToInvalidate = [
      dotyposTags.reservation.all(),
      dotyposTags.reservation.byId(reservationIdStr),
      dotyposTags.reservation.byCustomer(customerIdStr),
    ];

    for (const tag of tagsToInvalidate) {
      revalidateTag(tag, "max");
    }

    yield* Effect.logInfo("Cache invalidated for reservation update", {
      reservationId: reservationIdStr,
      customerId: customerIdStr,
      cacheTags: tagsToInvalidate,
    });

    const result: WebhookResult = {
      reservationId: reservation.reservationid,
      customerId: reservation.customerid,
      statusChange,
      emailSent,
      customerEmail: fullReservation.customer.email || null,
    };

    return { skipped: false, data: result };
  },
  (effect, input) =>
    effect.pipe(
      Effect.annotateLogs({
        operation: "processWebhook",
        input,
      })
    )
);

/**
 * POST /api/webhooks/reservation
 *
 * Receives reservation update webhooks from Dotypos
 *
 * NOTE: This webhook has special error handling - it returns 200 status
 * even for some errors to prevent Dotypos from retrying the webhook.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const program = Effect.gen(function* () {
    yield* Effect.log("Webhook invoked");

    // Validate webhook security using UUID
    const url = new URL(request.url);
    yield* validateWebhookUUID(url);

    // Parse request body
    const payload = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: () =>
        new WebhookValidationError({
          message: "Failed to parse request body",
        }),
    });

    // Process the webhook
    const result = yield* processWebhook(payload);

    return result;
  }).pipe(
    Effect.tapError(
      Effect.fn(function* (error) {
        yield* Effect.logError(error);
      })
    ),
    Effect.annotateLogs({
      method: "POST",
      operation: "webhook",
      request,
    }),
    Effect.catchTags({
      WebhookAuthError: (error) =>
        Effect.succeed(
          NextResponse.json(
            { error: "Unauthorized", message: error.message },
            { status: 401 }
          )
        ),
      WebhookValidationError: (error) =>
        Effect.succeed(
          NextResponse.json(
            {
              error: "Invalid payload",
              message: error.message,
              issues: error.issues,
              payload: error.payload,
            },
            { status: 400 }
          )
        ),
    }),
    // return 200 to prevent Dotypos from retrying
    // This is intentionally different from standard webhook error handling
    Effect.orElseSucceed(() =>
      NextResponse.json({
        success: true,
        error: "Internal processing error (logged)",
      })
    ),
    Effect.provide(
      Layer.mergeAll(
        DotyposConfig.Default,
        DotyposService.Default,
        StandaloneEmailServiceLive
      )
    )
  );

  try {
    const result = await Effect.runPromise(program);

    // Handle different result types
    if ("status" in result) {
      return NextResponse.json(result.body, { status: result.status });
    }

    if ("skipped" in result && result.skipped) {
      return NextResponse.json({
        success: true,
        message: result.message,
      });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (_error) {
    // This should rarely happen as we catch all errors in the Effect pipeline
    // IMPORTANT: Return 200 to prevent Dotypos from retrying
    return NextResponse.json(
      { success: true, error: "Internal processing error (logged)" },
      { status: 200 }
    );
  }
}

/**
 * GET /api/webhooks/reservation
 *
 * Health check endpoint for testing
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/reservation",
    accepts: "POST",
    description: "Dotypos reservation update webhook",
    security: "enabled (query param: ?secret=UUID)",
    validation: "Effect Schema validation enabled",
  });
}
