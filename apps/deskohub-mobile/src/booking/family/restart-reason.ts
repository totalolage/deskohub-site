import { Option } from "effect";
import { useEffect, useRef } from "react";
import { useScrollScreenToTop } from "../../ui/scroll-screen";
import type { CheckoutRestartReason } from "../checkout/booking-problem";
import { restartReasonOf } from "./booking-family-view";

/**
 * A family screen's restart reason from its `restart` parameter, while the
 * screen is `focused`. Each time it comes back into view with one (checkout
 * opened on top of it, then restarted the booking), even for the same
 * reason twice, `reread` reads availability and the quote again and the
 * screen scrolls back to its top, where the restart notice says why. A
 * screen that opens with the parameter reads them fresh and starts at the
 * top anyway.
 *
 * Out of view there's no reason, so the notice's live region empties under
 * the checkout and fills again on each return, once the screen is back in
 * view: assistive tech announces it every time, as the customer arrives.
 */
export const useRestartReasonInView = (
  restart: string | undefined,
  focused: boolean,
  reread: () => void
): Option.Option<CheckoutRestartReason> => {
  const scrollToTop = useScrollScreenToTop();
  const latest = useRef({ reread, scrollToTop });
  latest.current = { reread, scrollToTop };
  const focusedBefore = useRef(false);
  useEffect(() => {
    if (!focused) return;
    if (focusedBefore.current && Option.isSome(restartReasonOf(restart))) {
      latest.current.reread();
      latest.current.scrollToTop();
    }
    focusedBefore.current = true;
  }, [focused, restart]);
  return focused ? restartReasonOf(restart) : Option.none();
};
