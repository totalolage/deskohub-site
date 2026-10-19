import { Match, Option } from "effect";
import type { ReservationVisit } from "@/features/reservation/backend/reservation-visits.service";
import type { AutomationTriggerKind } from "./automation-states";

/**
 * What the pre-submit check makes of a run's trigger (§5.9): `send`,
 * `withdraw` because its reservation was cancelled or is gone (D28), or
 * `defer` because Dotypos moved its visit so the trigger hasn't happened
 * yet.
 */
export type AutomationTriggerVerdict = "send" | "withdraw" | "defer";

/** Whether a run triggered by `kind` reads its reservation's visit before sending. */
export const verifiesTriggeringVisit = (kind: AutomationTriggerKind) =>
  kind === "reservation-booked" ||
  kind === "reservation-started" ||
  kind === "reservation-finished";

/**
 * Whether a run's trigger still holds at `at`, from its reservation's live
 * visit. A booked, started or finished trigger is withdrawn when the visit
 * is cancelled or gone; a started or finished one is deferred while the
 * visit's start or end lies after `at`, as when the visit was extended. A
 * cancelled trigger is the cancellation itself, and schedule and account
 * triggers have no reservation, so they always send.
 */
export const stillHolds = (input: {
  readonly kind: AutomationTriggerKind;
  readonly visit: Option.Option<ReservationVisit>;
  readonly at: Temporal.Instant;
}): AutomationTriggerVerdict => {
  if (!verifiesTriggeringVisit(input.kind)) return "send";
  return Option.match(
    Option.filter(input.visit, (visit) => visit.status === "active"),
    {
      onNone: () => "withdraw",
      onSome: (visit) =>
        Match.value(input.kind).pipe(
          Match.when("reservation-started", () => visit.startsAt),
          Match.when("reservation-finished", () => visit.endsAt),
          Match.option,
          Option.filter(
            (reached) => Temporal.Instant.compare(reached, input.at) > 0
          ),
          Option.match({
            onNone: () => "send" as const,
            onSome: () => "defer" as const,
          })
        ),
    }
  );
};
