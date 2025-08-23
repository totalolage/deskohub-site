import { Effect } from "effect";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { DotyposServiceLive, getReservation } from "@/features/dotypos";
import { parseNoteWithMetadata } from "@/features/dotypos/utils/note-metadata";
import { StandaloneEmailServiceLive } from "@/features/email";
import { sendNewReservationNotification } from "@/features/email/backend/send-reservation-notification";
import {
  sendReservationConfirmedEmail,
  sendReservationCreatedEmail,
  sendReservationDeclinedEmail,
} from "@/features/email/backend/send-reservation-status-email";
import { getLocale, type Locale } from "@/i18n";
import { isDev } from "@/shared/utils/environment";

/**
 * Dotypos Reservation Webhook Payload
 */
interface DotyposReservationPayload {
  branchid: number;
  created: number;
  customerid: number;
  employeeid: number;
  flags: number;
  deleted: number;
  note: string | null;
  seats: number | string;
  status: number;
  tableid: number;
  taglist: string | null;
  versiondate: number;
  reservationid: number;
  startdate: number;
  enddate: number;
  cloudid: string;
}

/**
 * Map Dotypos status codes to our reservation states
 * Based on the examples:
 * - status: 0 = NEW (just created)
 * - status: 5 = CONFIRMED/ACCEPTED
 * - status: 10 = DECLINED/CANCELLED
 */
enum DotyposReservationStatus {
  NEW = 0,
  CONFIRMED = 5,
  DECLINED = 10,
}

/**
 * Determine what type of update this is by comparing status
 */
function getStatusChangeType(
  status: number
): "created" | "confirmed" | "declined" | "unknown" {
  switch (status) {
    case DotyposReservationStatus.NEW:
      return "created";
    case DotyposReservationStatus.CONFIRMED:
      return "confirmed";
    case DotyposReservationStatus.DECLINED:
      return "declined";
    default:
      console.warn(`Unknown reservation status: ${status}`);
      return "unknown";
  }
}

/**
 * POST /api/webhooks/reservation
 *
 * Receives reservation update webhooks from Dotypos
 */
export async function POST(request: Request) {
  console.log("=== Reservation Webhook Received ===");

  try {
    // Check webhook security (skip in development)
    if (!isDev()) {
      const url = new URL(request.url);
      const providedSecret = url.searchParams.get("secret");

      if (providedSecret !== env.DOTYPOS_WEBHOOK_SECRET) {
        console.error(
          "Webhook authentication failed - invalid or missing secret"
        );
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    
    // Parse the webhook payload
    const payload = (await request.json()) as DotyposReservationPayload[];

    // Dotypos sends an array with a single item
    if (!Array.isArray(payload) || payload.length === 0) {
      console.error("Invalid webhook payload: expected array");
      return NextResponse.json(
        { error: "Invalid payload format" },
        { status: 400 }
      );
    }

    const reservation = payload[0];
    if (!reservation) {
      console.error("Invalid webhook payload: no reservation data");
      return NextResponse.json(
        { error: "Invalid payload format" },
        { status: 400 }
      );
    }

    console.log("Webhook payload:", JSON.stringify(reservation, null, 2));

    // Determine the type of status change
    const statusChange = getStatusChangeType(reservation.status);
    console.log(
      `Status change type: ${statusChange} (status code: ${reservation.status})`
    );

    // Skip if unknown status or deleted
    if (statusChange === "unknown" || reservation.deleted === 1) {
      console.log("Skipping webhook - unknown status or deleted reservation");
      return NextResponse.json({
        success: true,
        message: "Webhook processed (no action taken)",
      });
    }

    // Process the webhook based on status
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Fetch full reservation and customer details from Dotypos
        console.log(
          `Fetching reservation ${reservation.reservationid} and customer ${reservation.customerid}`
        );

        const fullReservation = yield* getReservation(
          String(reservation.reservationid)
        );

        console.log(
          "Full reservation data:",
          JSON.stringify(fullReservation, null, 2)
        );

        // Parse the note to extract metadata including locale
        const parsedNote = parseNoteWithMetadata(
          fullReservation.reservation.note
        );
        console.log("Parsed note:", JSON.stringify(parsedNote, null, 2));

        const locale: Locale = parsedNote.metadata.locale || getLocale();
        console.log(`Using locale: ${locale}`);

        // Determine which email to send based on status
        let emailSent = false;

        if (fullReservation.customer.email) {
          console.log(
            `Sending ${statusChange} email to ${fullReservation.customer.email}`
          );

          // Send appropriate email based on status change
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
              console.log(
                "✅ Reservation created email sent to customer and notification sent to business"
              );
              break;

            case "confirmed":
              yield* sendReservationConfirmedEmail(
                fullReservation.reservation,
                fullReservation.customer,
                locale
              );
              emailSent = true;
              console.log("✅ Reservation confirmed email sent");
              break;

            case "declined":
              yield* sendReservationDeclinedEmail(
                fullReservation.reservation,
                fullReservation.customer,
                locale
              );
              emailSent = true;
              console.log("✅ Reservation declined email sent");
              break;

            default:
              console.log(
                `⏭️ Skipping email for unknown status: ${statusChange}`
              );
          }
        } else {
          console.log("⚠️ Customer has no email address, skipping email");
        }

        return {
          reservationId: reservation.reservationid,
          customerId: reservation.customerid,
          statusChange,
          emailSent,
          customerEmail: fullReservation.customer.email || null,
        };
      }).pipe(
        Effect.provide(DotyposServiceLive),
        Effect.provide(StandaloneEmailServiceLive)
      )
    );

    console.log("=== Webhook Processing Complete ===");
    console.log("Result:", result);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("=== Webhook Error ===");
    console.error("Error processing webhook:", error);

    // Log the error but return success to Dotypos
    // This prevents Dotypos from retrying the webhook unnecessarily
    return NextResponse.json({
      success: true,
      error: "Internal processing error (logged)",
    });
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
  });
}
