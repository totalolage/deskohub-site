import type { AutomationTriggerType as AutomationTrigger } from "@deskohub/workspace-admin-api";
import { Array as Arr, Option, Order } from "effect";
import { nextStartWithinHorizon } from "@/shared/utils/calendar-expression";
import type { AutomationVersionId } from "./automation-identifiers";

/** When one version of an automation took over, and what its trigger is. */
export type AutomationVersionActivation = {
  readonly id: AutomationVersionId;
  readonly activatedAt: Temporal.Instant;
  readonly trigger: AutomationTrigger;
};

const byActivation = Order.mapInput(
  Order.BigInt,
  (version: AutomationVersionActivation) => version.activatedAt.epochNanoseconds
);

const isAfter = (left: Temporal.Instant, right: Temporal.Instant) =>
  Temporal.Instant.compare(left, right) > 0;

/**
 * The version handling occurrences at `at`: the one with the latest
 * activation at or before it (D21). None before the first activation.
 */
export const versionInForce = <Version extends AutomationVersionActivation>(
  versions: ReadonlyArray<Version>,
  at: Temporal.Instant
): Option.Option<Version> =>
  Arr.findLast(
    Arr.sort(versions, byActivation),
    (version) => !isAfter(version.activatedAt, at)
  );

/**
 * The automation's first schedule fire strictly after `after` (design §5.7).
 * Each fire follows the calendar of the version in force at it, so a newer
 * version's calendar takes over at its activation, and a version without a
 * schedule trigger has no fires. None when no version fires again within the
 * calendar's eight-year horizon.
 */
export const nextFireAfter = (
  versions: ReadonlyArray<AutomationVersionActivation>,
  after: Temporal.Instant
): Option.Option<Temporal.Instant> => {
  const sorted = Arr.sort(versions, byActivation);
  let current = versionInForce(sorted, after);
  let from = after;
  for (;;) {
    const candidate = current.pipe(
      Option.flatMap(({ trigger }) =>
        trigger._tag === "Schedule"
          ? nextStartWithinHorizon(trigger.calendar, from)
          : Option.none()
      )
    );
    const takeover = Arr.findFirst(
      sorted,
      (version) =>
        Option.match(current, {
          onNone: () => isAfter(version.activatedAt, after),
          onSome: (inForce) =>
            isAfter(version.activatedAt, inForce.activatedAt),
        }) &&
        Option.match(candidate, {
          onNone: () => true,
          onSome: (fire) => !isAfter(version.activatedAt, fire),
        })
    );
    if (Option.isNone(takeover)) {
      return candidate;
    }
    // A fire at the activation instant is the newer version's.
    current = takeover;
    from = takeover.value.activatedAt.subtract({ nanoseconds: 1 });
  }
};
