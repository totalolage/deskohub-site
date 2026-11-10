import { Deferred, type Duration, Effect, Exit } from "effect";

/**
 * Where overlapping requests meet. Each arrival at a named spot waits until
 * `parties` arrivals have come there, so the requests overlap at that spot,
 * each still holding whatever it built.
 *
 * An arrival waits at most `deadline`. Code that hands one request another
 * request's result never brings the second request to the spot, so the
 * first goes on alone and the test fails on what the second received,
 * rather than timing out.
 */
export const makeMeetingPoint = (
  parties: number,
  deadline: Duration.Input = "2 seconds"
) => {
  const spots = new Map<
    string,
    { arrived: number; readonly everyone: Deferred.Deferred<void> }
  >();
  const spot = (name: string) => {
    const existing = spots.get(name);
    if (existing) return existing;
    const created = { arrived: 0, everyone: Deferred.makeUnsafe<void>() };
    spots.set(name, created);
    return created;
  };
  return {
    /** Arrives at `name` and waits there for the other parties. */
    arrive: (name: string) =>
      Effect.suspend(() => {
        const meeting = spot(name);
        meeting.arrived += 1;
        if (meeting.arrived === parties) {
          Deferred.doneUnsafe(meeting.everyone, Exit.void);
        }
        return Deferred.await(meeting.everyone).pipe(
          Effect.timeoutOrElse({
            duration: deadline,
            orElse: () => Effect.void,
          })
        );
      }),
    /** How many arrivals each spot had. */
    arrivals: () =>
      Object.fromEntries(
        [...spots].map(([name, { arrived }]) => [name, arrived])
      ),
  };
};

/** The overlapping requests' meeting point `makeMeetingPoint` makes. */
export type MeetingPoint = ReturnType<typeof makeMeetingPoint>;
