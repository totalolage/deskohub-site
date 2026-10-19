import {
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Latch,
} from "effect";
import { TestClock } from "effect/testing";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import { AutomationPlanner } from "./automation-planner.service";
import {
  type AutomationUnitOutcome,
  AutomationUnitProcessor,
} from "./automation-unit-processor.service";
import type {
  AutomationUnitQueueFake,
  AutomationUnitQueueFakeMessage,
} from "./automation-unit-queue.test-utils";

/** The processor's fetch deadline (`unitDeadline`, §5.2). */
const unitDeadlineMillis = 270_000;

/** The unit topic's `retryAfterSeconds` (§5.1). */
const redeliveryMillis = 60_000;

const minuteMillis = 60_000;

/** The consumer whose fiber is running, so a Dotypos fake can attribute a request. */
const SimulatedConsumer = Context.Reference(
  "@deskohub-workspace/test/SimulatedAutomationUnitConsumer",
  { defaultValue: (): SimulatedConsumer | undefined => undefined }
);

type ConsumerState = "running" | "parked" | "done";

type Park = {
  readonly consumer: SimulatedConsumer;
  readonly deferred: Deferred.Deferred<void>;
  cancelled: boolean;
};

type SimulatedConsumer = {
  readonly unitId: AutomationWorkUnitId;
  readonly deliveredAt: number;
  state: ConsumerState;
  park: Park | undefined;
  fiber: Fiber.Fiber<void> | undefined;
  requests: number;
  killOnRequest: number | undefined;
  settledAt: number | undefined;
  outcome: AutomationUnitOutcome | "redelivered" | "killed" | undefined;
};

/** One delivery of a unit message to a consumer, as the simulation saw it. */
type SimulatedDelivery = {
  readonly unitId: AutomationWorkUnitId;
  readonly deliveredAt: Temporal.Instant;
  /** When the consumer finished; undefined while it runs. */
  readonly settledAt: Temporal.Instant | undefined;
  readonly requests: number;
  readonly outcome:
    | AutomationUnitOutcome
    | "redelivered"
    | "killed"
    | undefined;
};

type SimulationEvent =
  | { readonly kind: "plan" }
  | {
      readonly kind: "deliver";
      readonly message: AutomationUnitQueueFakeMessage;
    }
  | { readonly kind: "wake"; readonly park: Park }
  | { readonly kind: "deadline"; readonly consumer: SimulatedConsumer }
  | { readonly kind: "kill"; readonly consumer: SimulatedConsumer };

type ScheduledEvent = {
  readonly at: number;
  readonly sequence: number;
  readonly event: SimulationEvent;
};

const instantOf = (millis: number) =>
  Temporal.Instant.fromEpochMilliseconds(millis);

/**
 * A deterministic discrete-event driver over the real planner and unit
 * processor (§5.12 tests). Simulated time is the `TestClock`; Postgres is
 * real. The minute cron runs the planner on every whole minute; every
 * published unit message reaches a consumer `overhead` later (claim,
 * commit, hand-off and queue delivery, the model's o); a consumer that
 * fails is redelivered 60 s later; and each Dotypos request a fake routes
 * through `dotyposRequest` holds its consumer for `latency`
 * (the model's L). Time advances only once every consumer is parked in a
 * request or finished, one event at a time in (time, sequence) order, so
 * same-instant commits never race. The processor's 270 s fetch deadline is
 * an event too, so the clock never jumps past it.
 */
export const makeAutomationEngineSimulation = (input: {
  readonly queue: AutomationUnitQueueFake;
  readonly start: Temporal.Instant;
  readonly latency: Duration.Input;
  readonly overhead: Duration.Input;
}) => {
  let now = input.start.epochMilliseconds;
  const latency = Duration.toMillis(Duration.fromInputUnsafe(input.latency));
  const overhead = Duration.toMillis(Duration.fromInputUnsafe(input.overhead));
  let sequence = 0;
  const events: ScheduledEvent[] = [];
  const consumers: SimulatedConsumer[] = [];
  const pendingKills: Array<{
    readonly unitId: AutomationWorkUnitId | undefined;
    readonly onRequest: number;
  }> = [];
  let running = 0;
  const quiescent = Latch.makeUnsafe(true);

  const schedule = (at: number, event: SimulationEvent) => {
    const entry = { at, sequence: sequence++, event };
    let index = events.length;
    while (
      index > 0 &&
      (events[index - 1]!.at > at ||
        (events[index - 1]!.at === at &&
          events[index - 1]!.sequence > entry.sequence))
    ) {
      index -= 1;
    }
    events.splice(index, 0, entry);
  };

  const setState = (consumer: SimulatedConsumer, state: ConsumerState) => {
    if (consumer.state === state) return;
    if (consumer.state === "running") running -= 1;
    if (state === "running") running += 1;
    consumer.state = state;
    if (running === 0) quiescent.openUnsafe();
    else quiescent.closeUnsafe();
  };

  const firstPlanAt = Math.ceil(now / minuteMillis) * minuteMillis;
  schedule(firstPlanAt, { kind: "plan" });

  /**
   * Holds the calling consumer for the latency. Fakes call it
   * before answering each Dotypos request; it returns the request's
   * consumer and its 1-based number within the delivery, or undefined
   * outside a simulated consumer (setup reads).
   */
  const dotyposRequest = Effect.gen(function* () {
    const consumer = yield* SimulatedConsumer;
    if (consumer === undefined) return undefined;
    if (consumer.park !== undefined) {
      // A unit's requests are sequential (§5.3); a second one in flight
      // would also stall the driver, which waits for the first.
      return yield* Effect.die(
        new Error(
          `Unit ${consumer.unitId} made concurrent Dotypos requests (§5.3)`
        )
      );
    }
    consumer.requests += 1;
    const request = {
      unitId: consumer.unitId,
      request: consumer.requests,
    } as const;
    const park: Park = {
      consumer,
      deferred: Deferred.makeUnsafe<void>(),
      cancelled: false,
    };
    consumer.park = park;
    schedule(
      consumer.killOnRequest === consumer.requests ? now : now + latency,
      consumer.killOnRequest === consumer.requests
        ? { kind: "kill", consumer }
        : { kind: "wake", park }
    );
    setState(consumer, "parked");
    yield* Deferred.await(park.deferred);
    return request;
  });

  const consume = Effect.fnUntraced(function* (
    message: AutomationUnitQueueFakeMessage
  ) {
    const processor = yield* AutomationUnitProcessor;
    const killIndex = pendingKills.findIndex(
      (kill) => kill.unitId === undefined || kill.unitId === message.unitId
    );
    const kill = killIndex === -1 ? undefined : pendingKills[killIndex];
    if (killIndex !== -1) pendingKills.splice(killIndex, 1);
    const consumer: SimulatedConsumer = {
      unitId: message.unitId,
      deliveredAt: now,
      state: "done",
      park: undefined,
      fiber: undefined,
      requests: 0,
      killOnRequest: kill?.onRequest,
      settledAt: undefined,
      outcome: undefined,
    };
    consumers.push(consumer);
    setState(consumer, "running");
    schedule(now + unitDeadlineMillis, { kind: "deadline", consumer });
    consumer.fiber = yield* processor.process(message.unitId).pipe(
      Effect.provideService(SimulatedConsumer, consumer),
      Effect.exit,
      Effect.flatMap((exit) =>
        Effect.sync(() => {
          if (consumer.outcome === "killed") return;
          // A request the fiber abandoned (an interrupted sibling) never wakes it.
          if (consumer.park !== undefined) consumer.park.cancelled = true;
          consumer.park = undefined;
          consumer.settledAt = now;
          if (Exit.isSuccess(exit)) {
            consumer.outcome = exit.value;
          } else {
            consumer.outcome = "redelivered";
            schedule(now + redeliveryMillis, { kind: "deliver", message });
          }
          setState(consumer, "done");
        })
      ),
      Effect.forkChild
    );
  });

  /** Gives every message published since the last event to a consumer `overhead` later. */
  const collectPublished = () => {
    for (
      let message = input.queue.take();
      message !== undefined;
      message = input.queue.take()
    ) {
      schedule(now + overhead, { kind: "deliver", message });
    }
  };

  const handle = (event: SimulationEvent) =>
    Effect.gen(function* () {
      switch (event.kind) {
        case "plan": {
          const planner = yield* AutomationPlanner;
          yield* planner.plan;
          schedule(now + minuteMillis, { kind: "plan" });
          return;
        }
        case "deliver":
          return yield* consume(event.message);
        case "wake": {
          const { park } = event;
          if (park.cancelled || park.consumer.state === "done") return;
          park.consumer.park = undefined;
          setState(park.consumer, "running");
          Deferred.doneUnsafe(park.deferred, Exit.void);
          return;
        }
        case "deadline": {
          // The processor's own timeout fires once the clock reaches it.
          const { consumer } = event;
          if (consumer.state !== "parked" || consumer.park === undefined) {
            return;
          }
          consumer.park.cancelled = true;
          consumer.park = undefined;
          setState(consumer, "running");
          return;
        }
        case "kill": {
          const { consumer } = event;
          if (consumer.park !== undefined) consumer.park.cancelled = true;
          consumer.park = undefined;
          consumer.outcome = "killed";
          consumer.settledAt = now;
          setState(consumer, "done");
          if (consumer.fiber !== undefined) {
            yield* Fiber.interrupt(consumer.fiber);
          }
          return;
        }
      }
    });

  const settle = quiescent.await.pipe(
    Effect.andThen(Effect.sync(collectPublished))
  );

  /**
   * Runs events up to `until` (inclusive), or until `stopWhen` holds; it is
   * checked whenever simulated time is about to move on. Returns the
   * instant the run stopped at.
   */
  const run = <E = never, R = never>(options: {
    readonly until: Temporal.Instant;
    readonly stopWhen?: Effect.Effect<boolean, E, R>;
    /** Runs after every event, once the engine is quiescent. */
    readonly afterEvent?: Effect.Effect<void, E, R>;
  }) =>
    Effect.gen(function* () {
      const until = options.until.epochMilliseconds;
      yield* TestClock.setTime(now);
      yield* settle;
      let stopped = false;
      for (;;) {
        const next = events[0];
        if (next === undefined || next.at > until) break;
        if (next.at > now) {
          stopped = options.stopWhen !== undefined && (yield* options.stopWhen);
          if (stopped) break;
          now = next.at;
        }
        events.shift();
        // The deadline handler marks its consumer running before the clock
        // fires the processor's timeout.
        if (next.event.kind === "deadline") yield* handle(next.event);
        yield* TestClock.setTime(now);
        if (next.event.kind !== "deadline") yield* handle(next.event);
        yield* settle;
        if (options.afterEvent) yield* options.afterEvent;
      }
      if (!stopped) {
        now = Math.max(now, until);
        yield* TestClock.setTime(now);
      }
      return instantOf(now);
    });

  return {
    dotyposRequest,
    run,
    /** Simulated now. */
    now: () => instantOf(now),
    /**
     * Interrupts the next consumer (of `unitId`, if given) at its
     * `onRequest`-th Dotypos request, as a crashed invocation: its claim
     * stays until the reaper takes it over.
     */
    killNextConsumer: (
      options: {
        readonly unitId?: AutomationWorkUnitId;
        readonly onRequest?: number;
      } = {}
    ) => {
      pendingKills.push({
        unitId: options.unitId,
        onRequest: options.onRequest ?? 1,
      });
    },
    deliveries: (): readonly SimulatedDelivery[] =>
      consumers.map((consumer) => ({
        unitId: consumer.unitId,
        deliveredAt: instantOf(consumer.deliveredAt),
        settledAt:
          consumer.settledAt === undefined
            ? undefined
            : instantOf(consumer.settledAt),
        requests: consumer.requests,
        outcome: consumer.outcome,
      })),
  };
};

export type AutomationEngineSimulation = ReturnType<
  typeof makeAutomationEngineSimulation
>;
