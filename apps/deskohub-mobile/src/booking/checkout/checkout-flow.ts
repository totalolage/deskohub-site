import type {
  CustomerBookingSelection,
  CustomerLocale,
} from "@deskohub/workspace-customer-api";
import { useAtomValue } from "@effect/atom-react";
import {
  Clock,
  Data,
  Duration,
  Effect,
  FiberSet,
  type Layer,
  Match,
  Option,
  Queue,
  Stream,
} from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";
import {
  type CustomerDataServices,
  customerDataRuntime,
} from "../../customer-api/customer-data-runtime";
import { BookingIds } from "../booking-ids.service";
import {
  type BookingServices,
  bookingServicesLayer,
} from "../data/booking-services-layer";
import { RememberedReferralCode } from "../remembered-referral.service";
import { isSideEffect, runCheckoutCommand } from "./checkout-commands";
import { startCheckout, step } from "./checkout-machine";
import {
  type CheckoutCommand,
  type CheckoutDetails,
  CheckoutEvent,
  type CheckoutState,
} from "./checkout-state";

/**
 * What a family screen hands the checkout screen: the selection it quoted
 * and the quote's advertised price token.
 */
export interface CheckoutRequest {
  readonly locale: CustomerLocale;
  readonly selection: CustomerBookingSelection;
  readonly advertisedPriceToken: string;
  /** Meeting room only. */
  readonly earlySetup?: boolean;
}

/**
 * The checkout the customer is about to start. A family screen sets it and
 * then opens `/book/checkout`; the checkout screen reads it and, finding
 * none (such as after a web reload), returns to `/book`.
 */
export const checkoutRequestAtom = Atom.keepAlive(
  Atom.make<Option.Option<CheckoutRequest>>(Option.none())
);

/** The customer's intents the checkout screen sends. */
export type CheckoutIntent = Extract<
  CheckoutEvent,
  {
    readonly _tag:
      | "CodeChanged"
      | "ApplyCode"
      | "AcceptPrice"
      | "ToggleConsent"
      | "Pay"
      | "Retry"
      | "ReloadLegalDocuments";
  }
>;

/**
 * - `Starting`: reading the remembered referral code and the flow's ids.
 * - `Running`: the machine's state, and the hold clock's latest tick (epoch
 *   milliseconds) for the countdown.
 */
export type CheckoutFlowView =
  | { readonly _tag: "Starting" }
  | {
      readonly _tag: "Running";
      readonly state: CheckoutState;
      readonly now: number;
    };

/** One checkout flow, alive while the checkout screen is mounted. */
export interface CheckoutController {
  readonly view: CheckoutFlowView;
  readonly send: (intent: CheckoutIntent) => void;
  /** Submits the details form with a new checkout attempt id. */
  readonly continueWith: (details: CheckoutDetails) => void;
}

/**
 * Runs one checkout for `request`: steps the machine, runs its commands on
 * the account's data runtime, feeds their answers back, and ticks the hold
 * clock. Unmounting interrupts every command and the clock. Navigation stays
 * with the checkout screen.
 */
export const useCheckoutFlow = (
  request: CheckoutRequest
): CheckoutController => {
  // One flow per request the screen holds: a new atom starts a new checkout.
  const flowAtom = useMemo(() => checkoutFlowAtom(request), [request]);
  return checkoutController(useAtomValue(flowAtom));
};

/** What a running flow takes: an event for the machine, or the details form. */
export type CheckoutFlowInput = Data.TaggedEnum<{
  Event: { readonly event: CheckoutEvent };
  /** Becomes `Continue` with a new checkout attempt id. */
  ContinueWith: { readonly details: CheckoutDetails };
}>;
export const CheckoutFlowInput = Data.taggedEnum<CheckoutFlowInput>();

/** A started flow: the machine's latest state, the clock, and its input. */
export interface RunningCheckout {
  readonly state: CheckoutState;
  /** The hold clock's latest tick, in epoch milliseconds. */
  readonly now: number;
  readonly send: (input: CheckoutFlowInput) => void;
}

/** How often the hold clock ticks, for the countdown and the hold's expiry. */
export const holdClockInterval = Duration.seconds(1);

/**
 * One checkout flow on the account's data runtime, alive while mounted. Each
 * call makes a new flow. Its value is waiting until the remembered referral
 * code and the session id are read, then each state the flow reaches.
 */
export const checkoutFlowAtom = (request: CheckoutRequest) =>
  customerDataRuntime.atom((get) =>
    checkoutFlow(request, get(bookingServicesLayer))
  );

/** The screen's controller over a flow atom's value. */
export const checkoutController = (
  flow: AsyncResult.AsyncResult<RunningCheckout, unknown>
): CheckoutController =>
  Option.match(AsyncResult.value(flow), {
    onNone: () => startingController,
    onSome: ({ state, now, send }) => ({
      view: { _tag: "Running", state, now },
      send: (intent) => send(CheckoutFlowInput.Event({ event: intent })),
      continueWith: (details) =>
        send(CheckoutFlowInput.ContinueWith({ details })),
    }),
  });

/** Nothing to send to before the flow starts. */
const startingController: CheckoutController = {
  view: { _tag: "Starting" },
  send: () => undefined,
  continueWith: () => undefined,
};

type BookingLayer = Layer.Layer<BookingServices, never, CustomerDataServices>;

/**
 * The flow as a stream of states. Its inputs (the screen's, the clock's and
 * the commands' answers) queue up and step the machine one at a time; each
 * step's commands start in order, side effects first, and run concurrently
 * in the flow's own fiber set, so ending the stream (unmounting) interrupts
 * them and the clock with it.
 */
const checkoutFlow = (request: CheckoutRequest, bookingLayer: BookingLayer) =>
  Stream.unwrap(
    Effect.Do.pipe(
      Effect.bind("started", () =>
        startFlow(request).pipe(Effect.provide(bookingLayer))
      ),
      Effect.bind("inputs", () => Queue.unbounded<CheckoutFlowInput>()),
      Effect.bind("commands", () => FiberSet.make<void>()),
      Effect.tap(({ inputs }) => tickHoldClock(inputs)),
      Effect.map(({ started, inputs, commands }) => {
        const send = (input: CheckoutFlowInput) =>
          void Queue.offerUnsafe(inputs, input);
        const run = (command: CheckoutCommand) =>
          FiberSet.run(
            commands,
            runCheckoutCommand(command).pipe(
              Effect.provide(bookingLayer),
              Effect.flatMap((answer) =>
                Effect.forEach(Option.toArray(answer), (event) =>
                  Queue.offer(inputs, CheckoutFlowInput.Event({ event }))
                )
              ),
              Effect.asVoid
            )
          );
        return Stream.fromQueue(inputs).pipe(
          Stream.mapAccumEffect(
            () => started,
            (view, input) =>
              eventOf(input).pipe(
                Effect.provide(bookingLayer),
                Effect.map((event) => advance(view, event)),
                Effect.tap(({ commands: next }) =>
                  Effect.forEach(inLaunchOrder(next), run, { discard: true })
                ),
                Effect.map(({ view: next }) => [next, [next]] as const)
              )
          ),
          Stream.prepend([started]),
          Stream.map((view): RunningCheckout => ({ ...view, send }))
        );
      })
    )
  );

interface FlowView {
  readonly state: CheckoutState;
  readonly now: number;
}

/** Reads the remembered referral code and makes the flow's session id. */
const startFlow = (request: CheckoutRequest) =>
  Effect.Do.pipe(
    Effect.bind("checkoutSessionId", () =>
      Effect.flatMap(Effect.service(BookingIds), (ids) => ids.checkoutSessionId)
    ),
    Effect.bind("rememberedReferralCode", () =>
      Effect.flatMap(
        Effect.service(RememberedReferralCode),
        (remembered) => remembered.get
      )
    ),
    Effect.bind("now", () => Clock.currentTimeMillis),
    Effect.map(
      ({ checkoutSessionId, rememberedReferralCode, now }): FlowView => ({
        state: startCheckout({
          ...request,
          checkoutSessionId,
          rememberedReferralCode,
        }),
        now,
      })
    )
  );

/** The machine event an input stands for; a details form gets a new attempt id. */
const eventOf = (input: CheckoutFlowInput) =>
  CheckoutFlowInput.$match(input, {
    Event: ({ event }) => Effect.succeed(event),
    ContinueWith: ({ details }) =>
      Effect.flatMap(
        Effect.service(BookingIds),
        (ids) => ids.checkoutAttemptId
      ).pipe(
        Effect.map((checkoutAttemptId) =>
          CheckoutEvent.Continue({ checkoutAttemptId, details })
        )
      ),
  });

/** Steps the machine; a clock tick also moves the view's clock. */
const advance = (view: FlowView, event: CheckoutEvent) => {
  const { state, commands } = step(view.state, event);
  const now = Match.value(event).pipe(
    Match.tag("HoldTimerElapsed", (tick) => tick.now),
    Match.orElse(() => view.now)
  );
  return { view: { state, now }, commands };
};

/** A step's commands with its side effects first (see `isSideEffect`). */
const inLaunchOrder = (commands: ReadonlyArray<CheckoutCommand>) => [
  ...commands.filter(isSideEffect),
  ...commands.filter((command) => !isSideEffect(command)),
];

/** Ticks the hold clock into the flow's inputs for the flow's lifetime. */
const tickHoldClock = (inputs: Queue.Queue<CheckoutFlowInput>) =>
  Stream.tick(holdClockInterval).pipe(
    Stream.mapEffect(() => Clock.currentTimeMillis),
    Stream.runForEach((now) =>
      Queue.offer(
        inputs,
        CheckoutFlowInput.Event({
          event: CheckoutEvent.HoldTimerElapsed({ now }),
        })
      )
    ),
    Effect.forkScoped
  );
