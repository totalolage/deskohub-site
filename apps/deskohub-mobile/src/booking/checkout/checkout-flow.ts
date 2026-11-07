import type {
  CustomerBookingSelection,
  CustomerLocale,
} from "@deskohub/workspace-customer-api";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
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
import { useEffect, useMemo } from "react";
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
  CheckoutCommand,
  type CheckoutDetails,
  CheckoutEvent,
  type CheckoutState,
  type OpenPaymentCommand,
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

/** What the checkout screen tells its flow besides the request. */
export interface CheckoutFlowOptions {
  /**
   * Whether the checkout screen is in view. While it isn't, the flow holds
   * the payment page and opens it once the screen is back (R8). Defaults to
   * in view.
   */
  readonly focused?: boolean;
}

/**
 * Runs one checkout for `request`: steps the machine, runs its commands on
 * the account's data runtime, feeds their answers back, and ticks the hold
 * clock. Unmounting interrupts every command and the clock. Navigation stays
 * with the checkout screen, and so does the payment page: it opens only
 * while `focused`.
 */
export const useCheckoutFlow = (
  request: CheckoutRequest,
  { focused = true }: CheckoutFlowOptions = {}
): CheckoutController => {
  // One flow per request the screen holds: a new atom starts a new checkout.
  const atoms = useMemo(() => {
    const focus = Atom.make(true);
    return { focus, flow: checkoutFlowAtom(request, focus) };
  }, [request]);
  const setFocus = useAtomSet(atoms.focus);
  useEffect(() => setFocus(focused), [setFocus, focused]);
  return checkoutController(useAtomValue(atoms.flow));
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
 * `focused` is whether the checkout screen is in view (see `leavesScreen`);
 * without it the screen is always in view.
 */
export const checkoutFlowAtom = (
  request: CheckoutRequest,
  focused: Atom.Atom<boolean> = Atom.make(true)
) =>
  customerDataRuntime.atom((get) => {
    // Kept for the flow's lifetime, so a focus change made before the flow
    // reads it isn't lost.
    get.mount(focused);
    return checkoutFlow(
      request,
      get(bookingServicesLayer),
      get.stream(focused)
    );
  });

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

/** The screen came into or went out of view. */
interface FocusChanged {
  readonly _tag: "FocusChanged";
  readonly focused: boolean;
}
const focusChanged = (focused: boolean): FocusChanged => ({
  _tag: "FocusChanged",
  focused,
});

/** Everything the flow steps on: the screen's input and its focus. */
type FlowInput = CheckoutFlowInput | FocusChanged;

/**
 * The flow as a stream of states. Its inputs (the screen's, its focus, the
 * clock's and the commands' answers) queue up and step the machine one at a
 * time; each step's commands start in order, side effects first, and run
 * concurrently in the flow's own fiber set, so ending the stream
 * (unmounting) interrupts them and the clock with it. A payment page asked
 * for while the screen is out of view waits for it (see `holdOffScreen`).
 */
const checkoutFlow = (
  request: CheckoutRequest,
  bookingLayer: BookingLayer,
  focus: Stream.Stream<boolean>
) =>
  Stream.unwrap(
    Effect.Do.pipe(
      Effect.bind("started", () =>
        startFlow(request).pipe(Effect.provide(bookingLayer))
      ),
      Effect.bind("inputs", () => Queue.unbounded<FlowInput>()),
      Effect.bind("commands", () => FiberSet.make<void>()),
      Effect.tap(({ inputs }) => tickHoldClock(inputs)),
      Effect.tap(({ inputs }) => followFocus(inputs, focus)),
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
            (): FlowRun => ({
              view: started,
              focused: true,
              held: Option.none(),
            }),
            (flow, input) =>
              stepFlow(flow, input).pipe(
                Effect.provide(bookingLayer),
                Effect.tap(({ launch }) =>
                  Effect.forEach(launch, run, { discard: true })
                ),
                Effect.map(
                  ({ flow: next, changed }) =>
                    [next, changed ? [next.view] : []] as const
                )
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

/** A running flow's view and what it keeps about the screen's focus. */
interface FlowRun {
  readonly view: FlowView;
  /** Whether the checkout screen is in view. */
  readonly focused: boolean;
  /** The payment page waiting for the screen to come back into view. */
  readonly held: Option.Option<OpenPaymentCommand>;
}

/** One input's effect on the flow: its next run, and the commands to start. */
interface FlowStep {
  readonly flow: FlowRun;
  readonly launch: ReadonlyArray<CheckoutCommand>;
  /** Whether the view changed, so the screen gets a new state. */
  readonly changed: boolean;
}

/** Steps the flow on one input. */
const stepFlow = (flow: FlowRun, input: FlowInput) =>
  input._tag === "FocusChanged"
    ? Effect.succeed(refocus(flow, input.focused))
    : eventOf(input).pipe(
        Effect.map((event): FlowStep => {
          const { view, commands } = advance(flow.view, event);
          const { launch, held } = holdOffScreen(flow, inLaunchOrder(commands));
          return { flow: { ...flow, view, held }, launch, changed: true };
        })
      );

/**
 * The commands that leave the checkout screen: the payment page opens over
 * whatever the customer is looking at (on web it leaves the app for good).
 */
const leavesScreen = CheckoutCommand.$is("OpenPayment");

/**
 * Out of view, a step's payment page is held instead of opened (R8), so it
 * can't open over another tab; every other command starts as usual.
 */
const holdOffScreen = (
  flow: FlowRun,
  commands: ReadonlyArray<CheckoutCommand>
): Pick<FlowStep, "launch"> & Pick<FlowRun, "held"> => {
  if (flow.focused) return { launch: commands, held: flow.held };
  const opening = commands.filter(leavesScreen).at(-1);
  return {
    launch: commands.filter((command) => !leavesScreen(command)),
    held: opening === undefined ? flow.held : Option.some(opening),
  };
};

/**
 * Back in view, the held payment page opens once, if the flow still waits
 * on that same page; a page the flow moved past is dropped.
 */
const refocus = (flow: FlowRun, focused: boolean): FlowStep => {
  const opening = focused
    ? Option.filter(flow.held, (held) => stillOpening(flow.view.state, held))
    : Option.none();
  return {
    flow: { ...flow, focused, held: focused ? Option.none() : flow.held },
    launch: Option.toArray(opening),
    changed: false,
  };
};

/** Whether `state` is still waiting for `opening`'s payment page. */
const stillOpening = (state: CheckoutState, opening: OpenPaymentCommand) =>
  state._tag === "Paying" &&
  Option.exists(
    state.opening,
    (current) => current.operationId === opening.operationId
  );

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

/** Feeds the screen's focus into the flow's inputs for the flow's lifetime. */
const followFocus = (
  inputs: Queue.Queue<FlowInput>,
  focus: Stream.Stream<boolean>
) =>
  focus.pipe(
    Stream.runForEach((focused) => Queue.offer(inputs, focusChanged(focused))),
    Effect.forkScoped
  );

/** Ticks the hold clock into the flow's inputs for the flow's lifetime. */
const tickHoldClock = (inputs: Queue.Queue<FlowInput>) =>
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
