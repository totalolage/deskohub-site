import "@/shared/polyfills/temporal";

import { Match } from "effect";
import {
  isWorkspaceCoworkProductTier,
  isWorkspaceMeetingRoomDuration,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import {
  getReservationDurationMinutes,
  isDefaultReservationInterval,
  type ReservationInterval,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";

export type ReservationProductRuleInput = Partial<ReservationInterval> &
  (
    | {
        readonly _tag: "cowork";
        readonly tier: WorkspaceCoworkProductTier;
        readonly coffee?: boolean;
        readonly monitorOption?: WorkspaceProductMonitorOption;
      }
    | {
        readonly _tag: "meeting-room";
        readonly coffee?: boolean;
        readonly monitorOption?: WorkspaceProductMonitorOption;
      }
    | {
        readonly entryTier: WorkspaceCoworkProductTier | "meeting-room";
        readonly coffee?: boolean;
        readonly monitorOption?: WorkspaceProductMonitorOption;
      }
  );

export type ReservationProductRuleIssue = {
  readonly path:
    | "entryTier"
    | "tier"
    | "coffee"
    | "monitorOption"
    | "endsAt"
    | "startsAt";
  readonly message: string;
};

const getProductRuleReservationKind = (input: ReservationProductRuleInput) =>
  Match.value(input).pipe(
    Match.tag("meeting-room", () => ({ _tag: "meeting-room" as const })),
    Match.tag("cowork", (coworkInput) => ({
      _tag: "cowork" as const,
      tier: coworkInput.tier,
    })),
    Match.when({ entryTier: "meeting-room" }, () => ({
      _tag: "meeting-room" as const,
    })),
    Match.when({ entryTier: "basic" }, (coworkInput) => ({
      _tag: "cowork" as const,
      tier: coworkInput.entryTier,
    })),
    Match.when({ entryTier: "plus" }, (coworkInput) => ({
      _tag: "cowork" as const,
      tier: coworkInput.entryTier,
    })),
    Match.when({ entryTier: "profi" }, (coworkInput) => ({
      _tag: "cowork" as const,
      tier: coworkInput.entryTier,
    })),
    Match.exhaustive
  );

export const getReservationProductRuleIssue = (
  input: ReservationProductRuleInput
): ReservationProductRuleIssue | null => {
  const interval = unsafeNormalizeReservationInterval(input);
  const durationMinutes = getReservationDurationMinutes(interval);
  const reservationKind = getProductRuleReservationKind(input);

  if (reservationKind._tag === "meeting-room") {
    if (!isWorkspaceMeetingRoomDuration(durationMinutes)) {
      return {
        path: "endsAt",
        message: "Meeting room duration must be 1 hour, 4 hours, or 24 hours.",
      };
    }

    if (!isWholeHourInPrague(interval.startsAt)) {
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

  if (isWorkspaceCoworkProductTier(reservationKind.tier)) {
    if (!isDefaultReservationInterval(interval)) {
      return {
        path: "endsAt",
        message: "Cowork reservations must use the full-day duration.",
      };
    }

    return null;
  }

  return {
    path: "_tag" in input ? "tier" : "entryTier",
    message: "Unknown reservation product.",
  };
};

const isWholeHourInPrague = (isoTimestamp: string) => {
  const time = Temporal.Instant.from(isoTimestamp)
    .toZonedDateTimeISO("Europe/Prague")
    .toPlainTime();

  return time.minute === 0 && time.second === 0 && time.millisecond === 0;
};
