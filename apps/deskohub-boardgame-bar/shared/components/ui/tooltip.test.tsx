import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps, MouseEvent, PointerEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

type TriggerProps = ComponentProps<"button">;

const renderTooltip = (props: ComponentProps<typeof Tooltip> = {}) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <Tooltip {...props}>
        <TooltipTrigger>Info</TooltipTrigger>
        <TooltipContent>Tip</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

const stateOf = (html: string) =>
  /<button[^>]*data-state="([^"]*)"/.exec(html)?.[1];

/**
 * Renders a trigger as `asChild` and returns the props Radix gives its child.
 * Events passed to those handlers should be default-prevented, which skips
 * Radix's own DOM-bound handlers after the trigger's.
 */
const triggerPropsFor = (
  tooltipProps: ComponentProps<typeof Tooltip>,
  triggerProps: ComponentProps<typeof TooltipTrigger> = {}
) => {
  let captured: TriggerProps | undefined;
  function TriggerChild(props: TriggerProps) {
    captured = props;
    return <button type="button" />;
  }
  renderToStaticMarkup(
    <TooltipProvider>
      <Tooltip {...tooltipProps}>
        <TooltipTrigger asChild {...triggerProps}>
          <TriggerChild />
        </TooltipTrigger>
      </Tooltip>
    </TooltipProvider>
  );
  if (!captured) throw new Error("The trigger did not render");
  return captured;
};

const pointerDown = (pointerType: string) =>
  ({ defaultPrevented: true, pointerType }) as PointerEvent<HTMLButtonElement>;
const click = (detail: number) =>
  ({ defaultPrevented: true, detail }) as MouseEvent<HTMLButtonElement>;

describe("Tooltip", () => {
  test("starts closed unless opened by default or by its owner", () => {
    const closed = renderTooltip();
    const openByDefault = renderTooltip({ defaultOpen: true });

    expect(stateOf(closed)).toBe("closed");
    expect(closed).not.toContain('role="tooltip"');
    expect(stateOf(openByDefault)).toBe("instant-open");
    expect(openByDefault).toContain('role="tooltip"');
    expect(stateOf(renderTooltip({ defaultOpen: true, open: false }))).toBe(
      "closed"
    );
    expect(stateOf(renderTooltip({ open: true }))).toBe("instant-open");
  });

  test("a touch tap on the trigger reports the toggled open state", () => {
    const onOpenChange = mock((_open: boolean) => {});
    const onPointerDown = mock(() => {});
    const onClick = mock(() => {});
    const trigger = triggerPropsFor(
      { onOpenChange },
      { onClick, onPointerDown }
    );

    trigger.onPointerDown?.(pointerDown("touch"));
    trigger.onClick?.(click(1));

    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onOpenChange.mock.calls).toEqual([[true]]);
  });

  test("a cancelled touch press reports nothing on its click", () => {
    const onOpenChange = mock((_open: boolean) => {});
    const onPointerCancel = mock(() => {});
    const trigger = triggerPropsFor(
      { onOpenChange, open: true },
      { onPointerCancel }
    );

    trigger.onPointerDown?.(pointerDown("touch"));
    trigger.onPointerCancel?.(pointerDown("touch"));
    trigger.onClick?.(click(1));

    expect(onPointerCancel).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("a trigger outside a tooltip is rejected", () => {
    expect(() => renderToStaticMarkup(<TooltipTrigger />)).toThrow(
      "TooltipTrigger must be used within Tooltip"
    );
  });
});
