import { beforeEach, describe, expect, test } from "bun:test";
import { Option } from "effect";
import { createElement } from "react";
import { clientRoot } from "../../testing/client-root";
import { ScrollScreenContext } from "../../ui/scroll-screen";
import { useRestartReasonInView } from "./restart-reason";

/**
 * A stand-in for the family screen's place in the book stack: its search
 * parameters, and whether it's in view or under the checkout.
 */
const screen = {
  params: {} as { restart?: string },
  focused: true,
};

const { render } = clientRoot();

/**
 * The family screen inside its scroll view, counting what it asks of both.
 * `show` renders it with the stack's current state, as the navigator does
 * when the screen's focus or parameters change.
 */
const familyScreen = () => {
  const seen = {
    reason: Option.none<string>(),
    rereads: 0,
    scrollsToTop: 0,
  };
  const scrollToTop = () => {
    seen.scrollsToTop += 1;
  };
  function Selection() {
    seen.reason = useRestartReasonInView(
      screen.params.restart,
      screen.focused,
      () => {
        seen.rereads += 1;
      }
    );
    return null;
  }
  const show = (state: Partial<typeof screen> = {}) => {
    Object.assign(screen, state);
    return render(
      createElement(
        ScrollScreenContext,
        { value: scrollToTop },
        createElement(Selection)
      )
    );
  };
  return { seen, show };
};

const expired = { restart: "hold_expired" };

describe("useRestartReasonInView", () => {
  beforeEach(async () => {
    await render(null);
    screen.params = {};
    screen.focused = true;
  });

  test("an expired hold's return shows its reason and scrolls it into view", async () => {
    const { seen, show } = familyScreen();
    await show();
    // Checkout opens on top; the customer had scrolled down to the calendar.
    await show({ focused: false });
    // The hold expires and checkout dismisses back here with the reason.
    await show({ focused: true, params: expired });

    expect(seen.reason).toEqual(Option.some("hold_expired"));
    expect(seen.rereads).toBe(1);
    expect(seen.scrollsToTop).toBe(1);
  });

  test("every return with the same reason shows it afresh and scrolls up", async () => {
    const { seen, show } = familyScreen();
    await show({ params: expired });
    expect(seen.reason).toEqual(Option.some("hold_expired"));

    for (const returns of [1, 2]) {
      // Under the checkout the notice empties, so its return is announced.
      await show({ focused: false });
      expect(seen.reason).toEqual(Option.none());
      await show({ focused: true });
      expect(seen.reason).toEqual(Option.some("hold_expired"));
      expect(seen.scrollsToTop).toBe(returns);
      expect(seen.rereads).toBe(returns);
    }
  });

  test("a reason that arrives while in view scrolls it into view", async () => {
    const { seen, show } = familyScreen();
    await show();
    await show({ params: expired });
    expect(seen.reason).toEqual(Option.some("hold_expired"));
    expect(seen.scrollsToTop).toBe(1);
  });

  test("a screen that opens with a reason starts at the top already", async () => {
    const { seen, show } = familyScreen();
    await show({ params: expired });
    await show();
    expect(seen.reason).toEqual(Option.some("hold_expired"));
    expect(seen.scrollsToTop).toBe(0);
    expect(seen.rereads).toBe(0);
  });

  test("a return without a reason keeps the customer's scroll position", async () => {
    const { seen, show } = familyScreen();
    await show();
    await show({ focused: false });
    await show({ focused: true });
    expect(seen.reason).toEqual(Option.none());
    expect(seen.scrollsToTop).toBe(0);
    expect(seen.rereads).toBe(0);
  });
});
