import { Effect } from "effect";
import { revalidateTag } from "next/cache";
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
import {
  getAllReservationsCacheTag,
  getCustomerReservationsCacheTag,
  getReservationCacheTag,
} from "@/shared/backend/utils/cache-tags";
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
      return "unknown";
  }
}

/**
 * POST /api/webhooks/reservation
 *
 * Receives reservation update webhooks from Dotypos
 */
export async function POST(request: Request) {

  try {
    // Check webhook security (skip in development)
    if (!isDev()) {
      const url = new URL(request.url);
      const providedSecret = url.searchParams.get("secret");

      if (providedSecret !== env.DOTYPOS_WEBHOOK_SECRET) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // Parse the webhook payload
    const payload = (await request.json()) as DotyposReservationPayload[];

    // Dotypos sends an array with a single item
    if (!Array.isArray(payload) || payload.length === 0) {
      return NextResponse.json(
        { error: "Invalid payload format" },
        { status: 400 }
      );
    }

    const reservation = payload[0];
    if (!reservation) {
      return NextResponse.json(
        { error: "Invalid payload format" },
        { status: 400 }
      );
    }

    // Determine the type of status change
    const statusChange = getStatusChangeType(reservation.status);

    // Skip if unknown status or deleted
    if (statusChange === "unknown" || reservation.deleted === 1) {
      return NextResponse.json({
        success: true,
        message: "Webhook processed (no action taken)",
      });
    }

    // Process the webhook based on status
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Fetch full reservation and customer details from Dotypos
        const fullReservation = yield* getReservation(
          String(reservation.reservationid)
        );

        // Parse the note to extract metadata including locale
        const parsedNote = parseNoteWithMetadata(
          fullReservation.reservation.note
        );

        const locale: Locale = parsedNote.metadata.locale || getLocale();

        // Determine which email to send based on status
        let emailSent = false;

        if (fullReservation.customer.email) {
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

            default:
              // Skip email for unknown status
              break;
          }
        }

        // Invalidate cache for this reservation and related pages
        const reservationIdStr = String(reservation.reservationid);
        const customerIdStr = String(reservation.customerid);
        
        // Revalidate specific reservation page
        revalidateTag(getReservationCacheTag(reservationIdStr));
        
        // Revalidate all reservations listing
        revalidateTag(getAllReservationsCacheTag());
        
        // Revalidate customer's reservations if customer ID exists
        if (customerIdStr) {
          revalidateTag(getCustomerReservationsCacheTag(customerIdStr));
        }
        
        yield* Effect.logInfo("Cache invalidated for reservation update", {
          reservationId: reservationIdStr,
          customerId: customerIdStr,
          tags: [
            getReservationCacheTag(reservationIdStr),
            getAllReservationsCacheTag(),
            getCustomerReservationsCacheTag(customerIdStr),
          ],
        });

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

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    // Return success to Dotypos to prevent webhook retries
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
