import { Effect } from "effect";
import type { WorkspaceAvailabilityOccupancyExclusion } from "./workspace-availability.service";

export const recoverReplacementOccupancyExclusion = <E, R>(
  lookup: Effect.Effect<
    WorkspaceAvailabilityOccupancyExclusion | undefined,
    E,
    R
  >
) =>
  lookup.pipe(
    Effect.tapError((cause) =>
      Effect.logWarning(
        "Replacement reservation verification unavailable; loading ordinary availability",
        { cause }
      )
    ),
    Effect.catch(() => Effect.succeed(undefined))
  );
