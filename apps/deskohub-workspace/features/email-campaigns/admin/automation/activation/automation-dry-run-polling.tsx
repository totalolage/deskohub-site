"use client";

import { useAtomMount, useAtomSubscribe } from "@effect/atom-react";
import { Schedule, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useRouter } from "next/navigation";

/** Ticks while mounted; each tick asks for the dry run's progress again. */
const dryRunPollAtom = Atom.make(
  Stream.fromSchedule(Schedule.spaced("3 seconds"))
);

/**
 * Refreshes the route every few seconds while it is mounted, so a running
 * dry run's progress and results update until the job settles.
 */
export function AutomationDryRunPolling() {
  const router = useRouter();
  // Subscribing alone never reads the atom, so its stream wouldn't start;
  // mounting runs it while this component is mounted.
  useAtomMount(dryRunPollAtom);
  useAtomSubscribe(dryRunPollAtom, (tick) => {
    if (AsyncResult.isSuccess(tick)) router.refresh();
  });
  return null;
}
