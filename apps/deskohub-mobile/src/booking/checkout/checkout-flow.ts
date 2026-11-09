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
  Ref,
  Stream,
} from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef } from "react";
import { reservationHistoryAtom } from "../../account/reservations/reservations-list-state";
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
   * Whether the checkout screen is in view, as last rendered. While it
   * isn't, the flow holds the payment page and opens it once the screen is
   * back (R8). Defaults to in view.
   */
  readonly focused?: boolean;
  /**
   * Whether the screen is in view right now, such as the navigation's
   * `isFocused`. The flow asks as the payment page would open, so a blur
   * not yet rendered still holds the page.
   */
  readonly isFocused?: () => boolean;
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
  { focused = true, isFocused }: CheckoutFlowOptions = {}
): CheckoutController => {
  // Later values reach the flow through the effects below.
  const initialFocus = useRef(focused);
  const liveFocus = useRef(isFocused);
  useEffect(() => {
    liveFocus.current = isFocused;
  }, [isFocused]);
  // One flow per request the screen holds: a new atom starts a new checkout.
  const atoms = useMemo(() => {
    const focus = Atom.make(initialFocus.current);
    const inViewNow = () => liveFocus.current?.() ?? true;
    return { focus, flow: checkoutFlowAtom(request, focus, inViewNow) };
  }, [request]);
  const setFocus = useAtomSet(atoms.focus);
  useEffect(() => setFocus(focused), [setFocus, focused]);
  // Gone, the screen is out of view, even before the flow's teardown: a
  // refocus still queued can't open the page.
  useEffect(() => () => setFocus(false), [setFocus]);
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
 * `focused` is whether the checkout screen is in view as last rendered, and
 * `isFocused` whether it is right now (see `leavesScreen`); the page opens
 * only when both say so. Without them the screen is always in view.
 */
export const checkoutFlowAtom = (
  request: CheckoutRequest,
  focused: Atom.Atom<boolean> = Atom.make(true),
  isFocused: () => boolean = () => true
) =>
  customerDataRuntime.atom((get) => {
    // Mounted for the flow's lifetime, so its current value is the screen's.
    get.mount(focused);
    return checkoutFlow(
      request,
      get(bookingServicesLayer),
      {
        current: () => get.registry.get(focused) && isFocused(),
        regained: get
          .stream(focused, { withoutInitialValue: true })
          .pipe(Stream.filter((inView) => inView)),
      },
      // Through the registry: the flow's end may run after its context's.
      // A registry disposed with the account (sign-out) throws instead;
      // nothing is left to refresh then.
      Effect.sync(() => get.registry.refresh(reservationHistoryAtom)).pipe(
        Effect.catchDefect(() => Effect.void)
      )
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

/** The checkout screen's focus, as the flow reads it. */
interface ScreenFocus {
  /** Whether the screen is in view right now. */
  readonly current: () => boolean;
  /** Each time the screen comes back into view. */
  readonly regained: Stream.Stream<boolean>;
}

/** The screen came back into view. */
interface Refocused {
  readonly _tag: "Refocused";
}
const refocused: Refocused = { _tag: "Refocused" };

/** Everything the flow steps on: the screen's input and its focus. */
type FlowInput = CheckoutFlowInput | Refocused;

/**
 * The flow as a stream of states. Its inputs (the screen's, its refocus, the
 * clock's and the commands' answers) queue up and step the machine one at a
 * time; each step's commands start in order, side effects first, and run
 * concurrently in the flow's own fiber set, so ending the stream
 * (unmounting) interrupts them and the clock with it. A payment page asked
 * for while the screen is out of view waits for it (see `leavesScreen`).
 * Each submitted booking runs `refreshReservations` once, so the
 * Reservations list shows it: on reaching `Done`, or as the flow ends if it
 * was left at the payment page (see `awaitsPayment`).
 */
const checkoutFlow = (
  request: CheckoutRequest,
  bookingLayer: BookingLayer,
  focus: ScreenFocus,
  refreshReservations: Effect.Effect<void>
) =>
  Stream.unwrap(
    Effect.Do.pipe(
      Effect.bind("started", () =>
        startFlow(request).pipe(Effect.provide(bookingLayer))
      ),
      Effect.bind("inputs", () => Queue.unbounded<FlowInput>()),
      Effect.bind("commands", () => FiberSet.make<void>()),
      Effect.bind("held", () =>
        Ref.make<Option.Option<OpenPaymentCommand>>(Option.none())
      ),
      // Whether a submitted booking is still missing from the list.
      Effect.bind("owed", () => Ref.make(false)),
      Effect.tap(({ owed }) =>
        Effect.addFinalizer(() =>
          refreshReservations.pipe(Effect.when(Ref.get(owed)))
        )
      ),
      Effect.tap(({ inputs }) => tickHoldClock(inputs)),
      Effect.tap(({ inputs }) => followRefocus(inputs, focus.regained)),
      Effect.map(({ started, inputs, commands, held, owed }) => {
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
        // Out of view, the payment page is held instead of opened (R8), so
        // it can't open over another tab. Focus is read as the page would
        // open, not from the queue, so a blur still queued counts.
        const launch = (command: CheckoutCommand) =>
          leavesScreen(command)
            ? Effect.suspend(() =>
                focus.current()
                  ? run(command)
                  : Ref.set(held, Option.some(command))
              )
            : run(command);
        // Back in view, the held page opens once, if the flow still waits
        // on that same page; a page the flow moved past is dropped. A
        // refocus releases it at once; every other input tries too, so a
        // blur the navigation took back before React rendered it opens the
        // page by the clock's next tick.
        const release = (view: FlowView) =>
          Effect.suspend(() =>
            focus.current()
              ? Ref.getAndSet(held, Option.none()).pipe(
                  Effect.flatMap((page) =>
                    Effect.forEach(
                      Option.toArray(
                        Option.filter(page, (opening) =>
                          stillOpening(view.state, opening)
                        )
                      ),
                      run,
                      { discard: true }
                    )
                  )
                )
              : Effect.void
          );
        // Done reads the list now; once a submit awaits payment, the list is
        // owed a read until then, which the flow's end pays if Done never
        // comes.
        const followBooking = (before: CheckoutState, after: CheckoutState) =>
          finishesBooking(before, after)
            ? Ref.set(owed, false).pipe(Effect.andThen(refreshReservations))
            : Ref.set(owed, true).pipe(
                Effect.when(Effect.succeed(awaitsPayment(after)))
              );
        return Stream.fromQueue(inputs).pipe(
          Stream.mapAccumEffect(
            () => started,
            (view, input) =>
              input._tag === "Refocused"
                ? release(view).pipe(Effect.as([view, []] as const))
                : eventOf(input).pipe(
                    Effect.provide(bookingLayer),
                    Effect.map((event) => advance(view, event)),
                    Effect.tap(({ commands: next }) =>
                      Effect.forEach(inLaunchOrder(next), launch, {
                        discard: true,
                      })
                    ),
                    Effect.tap(({ view: next }) => release(next)),
                    Effect.tap(({ view: next }) =>
                      followBooking(view.state, next.state)
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

/**
 * The commands that leave the checkout screen: the payment page opens over
 * whatever the customer is looking at (on web it leaves the app for good).
 */
const leavesScreen = CheckoutCommand.$is("OpenPayment");

/**
 * Whether a step reaches `Done`, which every finished booking reaches once
 * (paid, returned from or dismissing the payment page, or a submit shown by
 * its status): the order is now on the account's reservations.
 */
const finishesBooking = (before: CheckoutState, after: CheckoutState) =>
  before._tag !== "Done" && after._tag === "Done";

/**
 * Whether `state` holds a submitted booking awaiting payment, which the
 * customer may leave before `Done`.
 */
const awaitsPayment = (state: CheckoutState) => state._tag === "Paying";

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

/** Feeds each refocus into the flow's inputs for the flow's lifetime. */
const followRefocus = (
  inputs: Queue.Queue<FlowInput>,
  regained: Stream.Stream<boolean>
) =>
  regained.pipe(
    Stream.runForEach(() => Queue.offer(inputs, refocused)),
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
