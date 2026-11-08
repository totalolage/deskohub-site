import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import {
  openPayState,
  PayStateTokenError,
  payStateContinuesOn,
} from "./pay-state";

/**
 * Opens a Pay state only for the language it was signed for, so a token
 * never continues in another locale's checkout.
 */
export const openPayStateForLocale = Effect.fn("payState.openForLocale")(
  function* (input: {
    readonly payStateToken: string;
    readonly locale: Locale;
  }) {
    const state = yield* openPayState(input.payStateToken);
    if (!payStateContinuesOn(state, { locale: input.locale })) {
      return yield* new PayStateTokenError({
        code: "invalid-token",
        message: "Pay state locale does not match the request locale.",
      });
    }
    return state;
  }
);
