import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useTooltipTouchTap } from "./tooltip-touch-tap";

/** Renders the hook once for a tooltip that is `open` and returns its result. */
const touchTapFor = (open: boolean) => {
  const setOpen = mock((_nextOpen: boolean) => {});
  let result: ReturnType<typeof useTooltipTouchTap> | undefined;
  function Probe() {
    result = useTooltipTouchTap(open, setOpen);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (!result) throw new Error("The touch tap hook did not render");
  return { ...result, setOpen };
};

const settledTaps = () =>
  new Promise<void>((resolve) => queueMicrotask(resolve));

describe("useTooltipTouchTap", () => {
  test("a touch tap toggles the tooltip", () => {
    const closed = touchTapFor(false);
    closed.touchTap.press("touch");
    closed.touchTap.tap(1);

    const open = touchTapFor(true);
    open.touchTap.press("touch");
    open.touchTap.tap(1);

    expect(closed.setOpen.mock.calls).toEqual([[true]]);
    expect(open.setOpen.mock.calls).toEqual([[false]]);
  });

  test("ignores Radix's open change during the tap's click, then honors it", async () => {
    const { onRadixOpenChange, setOpen, touchTap } = touchTapFor(false);
    touchTap.press("touch");
    touchTap.tap(1);
    onRadixOpenChange(false);

    expect(setOpen.mock.calls).toEqual([[true]]);

    await settledTaps();
    onRadixOpenChange(false);

    expect(setOpen.mock.calls).toEqual([[true], [false]]);
  });

  test("passes Radix's open changes through without a tap", () => {
    const { onRadixOpenChange, setOpen } = touchTapFor(false);
    onRadixOpenChange(true);

    expect(setOpen.mock.calls).toEqual([[true]]);
  });

  test("leaves mouse and pen clicks to Radix", () => {
    const { setOpen, touchTap } = touchTapFor(false);
    touchTap.press("mouse");
    touchTap.tap(1);
    touchTap.press("pen");
    touchTap.tap(1);

    expect(setOpen).not.toHaveBeenCalled();
  });

  test("leaves a keyboard click after a touch press to Radix", () => {
    const { setOpen, touchTap } = touchTapFor(false);
    touchTap.press("touch");
    touchTap.tap(0);
    touchTap.tap(1);

    expect(setOpen).not.toHaveBeenCalled();
  });

  test("a cancelled press does not toggle on a later click", () => {
    const { setOpen, touchTap } = touchTapFor(false);
    touchTap.press("touch");
    touchTap.cancelPress();
    touchTap.tap(1);

    expect(setOpen).not.toHaveBeenCalled();
  });

  test("a touch press settles on a single tap", () => {
    const { setOpen, touchTap } = touchTapFor(false);
    touchTap.press("touch");
    touchTap.tap(1);
    touchTap.tap(1);

    expect(setOpen.mock.calls).toEqual([[true]]);
  });
});
