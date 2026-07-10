import { Data, Schema } from "effect";
import {
  isWorkspaceMeetingRoomDuration,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import {
  getReservationDurationMinutes,
  isDefaultReservationInterval,
  type ReservationInterval,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";
import { makeWholeHourInstantStringEffectSchema } from "@/shared/utils/temporal";

type ReservationProductRuleIntervalInput = Partial<ReservationInterval> & {
  readonly date?: string;
};

export type ReservationProductRuleInput = Data.TaggedEnum<{
  cowork: ReservationProductRuleIntervalInput & {
    readonly tier: WorkspaceCoworkProductTier;
    readonly coffee?: boolean;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  };
  "meeting-room": ReservationProductRuleIntervalInput & {
    readonly coffee?: boolean;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  };
}>;

export const ReservationProductRuleInput =
  Data.taggedEnum<ReservationProductRuleInput>();

type ReservationProductRuleFields = ReservationProductRuleIntervalInput & {
  readonly entryTier?: WorkspaceCoworkProductTier;
  readonly tier?: WorkspaceCoworkProductTier;
  readonly coffee?: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

export type ReservationProductRuleIssue = {
  readonly path: keyof ReservationProductRuleFields;
  readonly message: string;
};

const isWholeHourInReservationTimeZone = Schema.is(
  makeWholeHourInstantStringEffectSchema(reservationTimeZone)
);

export const getReservationProductRuleIssue = (
  input: ReservationProductRuleInput
): ReservationProductRuleIssue | null => {
  const interval = unsafeNormalizeReservationInterval(input);
  const durationMinutes = getReservationDurationMinutes(interval);

  if (input._tag === "meeting-room") {
    if (!isWorkspaceMeetingRoomDuration(durationMinutes)) {
      return {
        path: "endsAt",
        message: "Meeting room duration must be 1 hour, 4 hours, or 24 hours.",
      };
    }

    if (!isWholeHourInReservationTimeZone(interval.startsAt)) {
      return {
        path: "startsAt",
        message: "Meeting room reservations must start on a whole hour.",
      };
    }

    if (input.coffee === true) {
      return {
        path: "coffee",
        message: "Coffee cannot be added to meeting room reservations.",
      };
    }

    if (input.monitorOption) {
      return {
        path: "monitorOption",
        message: "Monitor setup is unavailable for meeting room reservations.",
      };
    }

    return null;
  }

  if (!isDefaultReservationInterval(interval)) {
    return {
      path: "endsAt",
      message: "Cowork reservations must use the full-day duration.",
    };
  }

  return null;
};
