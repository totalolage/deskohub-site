import { createHash } from "node:crypto";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  getWorkspaceProductByTier,
} from "@/features/checkout/product-catalog";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import { getStoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import { getStoredMeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import {
  type StoredWorkspaceReservationDetails,
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import type { Money } from "@/shared/money/money";

/**
 * A reservation in a review account's sandbox: a sample the account always
 * shows, or a simulated hold one of its bookings made. Nothing behind it
 * exists in Dotypos, Nexi, or the reservation ledger.
 *
 * `state` is what the reviewer sees: an `open` hold awaits a payment that the
 * sandbox never takes, a superseded hold is `cancelled`, a lapsed one
 * `expired`, and a sample is a `completed` (paid and confirmed) booking.
 */
export type ReviewSandboxReservation = {
  readonly orderId: WorkspaceReservationId;
  readonly details: StoredWorkspaceReservationDetails;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly seats: number;
  readonly total: Money;
  readonly state: "open" | "cancelled" | "expired" | "completed";
};

const sampleOrderIdPrefix = "review-sample-";

/** Whether an order ID names a sample, so only those need a sample lookup. */
export const isReviewSampleOrderId = (orderId: WorkspaceReservationId) =>
  orderId.startsWith(sampleOrderIdPrefix);

/** The order ID of one sample, stable per account and sample. */
const sampleOrderId = (accountId: CustomerAccountId, sample: string) =>
  workspaceReservationIdSchema.make(
    `${sampleOrderIdPrefix}${createHash("sha256")
      .update(
        ["deskohub-workspace/review-sample", accountId, sample].join("\0")
      )
      .digest("base64url")
      .slice(0, 22)}`
  );

const meetingRoomSampleDuration = { unit: "hour", amount: 4 } as const;

/**
 * The fully populated history every review account shows: a cowork day it
 * used last week and a meeting room booked for later this week, dated
 * relative to today in the Workspace's time zone.
 */
export const getReviewSampleReservations = (
  accountId: CustomerAccountId,
  now: Temporal.Instant
): readonly ReviewSandboxReservation[] => {
  const today = getCurrentWorkspaceDate(now);
  const coworkDay = getCoworkReservationInterval(
    "open-space",
    today.subtract({ days: 7 }).toString()
  );
  const meetingRoom = getMeetingRoomReservationInterval(
    `${today.add({ days: 3 }).toString()}T09:00`,
    meetingRoomSampleDuration
  );

  return [
    {
      orderId: sampleOrderId(accountId, "past-cowork-day"),
      details: getStoredCoworkReservationDetails({
        entryTier: "open-space",
        coffee: false,
      }),
      startsAt: Temporal.Instant.from(coworkDay.startsAt),
      endsAt: Temporal.Instant.from(coworkDay.endsAt),
      seats: 1,
      total: getWorkspaceProductByTier("open-space").price,
      state: "completed",
    },
    ...(meetingRoom
      ? [
          {
            orderId: sampleOrderId(accountId, "upcoming-meeting-room"),
            details: getStoredMeetingRoomReservationDetails({
              kind: "meeting-room",
              duration: meetingRoomSampleDuration,
            }),
            startsAt: Temporal.Instant.from(meetingRoom.startsAt),
            endsAt: Temporal.Instant.from(meetingRoom.endsAt),
            seats: 1,
            total: getWorkspaceMeetingRoomPriceForDuration(
              meetingRoomSampleDuration
            ),
            state: "completed" as const,
          },
        ]
      : []),
  ];
};
