import { DateTime, Schedule, Stream } from "effect";
import {
  type AccessWindow,
  type AccessWindowState,
  accessWindowState,
} from "./access-window";

/** The current time at once, then every second, from the Clock service. */
export const secondClock: Stream.Stream<DateTime.Utc> = Stream.fromSchedule(
  Schedule.spaced("1 second")
).pipe(
  Stream.prepend([0]),
  Stream.mapEffect(() => DateTime.now)
);

/**
 * The window's state every second, ending with the tick that finds it over:
 * an ended window never changes again, so the clock stops.
 */
export const accessWindowStates = ({
  startsAt,
  endsAt,
}: AccessWindow): Stream.Stream<AccessWindowState> =>
  secondClock.pipe(
    Stream.map((now) => accessWindowState(now, startsAt, endsAt)),
    Stream.takeUntil((state) => state._tag === "Ended")
  );
