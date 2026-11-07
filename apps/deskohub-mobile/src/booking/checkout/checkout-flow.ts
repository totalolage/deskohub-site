import type {
  CustomerBookingSelection,
  CustomerLocale,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { useReducer } from "react";
import { startCheckout, step } from "./checkout-machine";
import {
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
 * clock. Unmounting interrupts every command and the clock.
 *
 * SEAM STUB: the interpreter stream replaces this body. Until then it steps
 * the machine locally and drops its commands, so a Continue stays Creating.
 */
export const useCheckoutFlow = (
  request: CheckoutRequest
): CheckoutController => {
  const [state, dispatch] = useReducer(
    (current: CheckoutState, event: CheckoutEvent) =>
      step(current, event).state,
    request,
    (initial) =>
      startCheckout({
        ...initial,
        checkoutSessionId: "seam-stub-session",
        rememberedReferralCode: Option.none(),
      })
  );
  return {
    view: { _tag: "Running", state, now: Date.now() },
    send: dispatch,
    continueWith: (details) =>
      dispatch(
        CheckoutEvent.Continue({
          checkoutAttemptId: "seam-stub-attempt",
          details,
        })
      ),
  };
};
