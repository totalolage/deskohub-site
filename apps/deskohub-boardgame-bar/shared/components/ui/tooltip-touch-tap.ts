import { useRef } from "react";

export type TooltipTouchTap = {
  /** Starts a trigger press; only touch presses toggle the tooltip on tap. */
  readonly press: (pointerType: string) => void;
  readonly cancelPress: () => void;
  /** Settles the latest touch press when its click arrives. */
  readonly tap: (clickDetail: number) => void;
};

/**
 * Toggles a tooltip on a touch tap of its trigger. Returns the trigger's
 * press and tap callbacks, and the handler for Radix's own open changes, which
 * ignores the close Radix sends on the tap's click.
 */
export function useTooltipTouchTap(
  open: boolean,
  setOpen: (nextOpen: boolean) => void
) {
  /** Open state the trigger's latest touch press settles on when it taps. */
  const tapOpen = useRef<boolean | undefined>(undefined);
  /** Whether Radix's close on the tap's click is being ignored. */
  const isApplyingTap = useRef(false);
  const touchTap: TooltipTouchTap = {
    cancelPress: () => {
      tapOpen.current = undefined;
    },
    press: (pointerType) => {
      tapOpen.current = pointerType === "touch" ? !open : undefined;
    },
    tap: (clickDetail) => {
      const nextOpen = tapOpen.current;
      tapOpen.current = undefined;
      // Keyboard activation clicks report no detail and keep Radix's behavior.
      if (nextOpen === undefined || clickDetail === 0) return;
      setOpen(nextOpen);
      // Radix's own click handler runs after the trigger's in the same dispatch.
      isApplyingTap.current = true;
      queueMicrotask(() => {
        isApplyingTap.current = false;
      });
    },
  };
  const onRadixOpenChange = (nextOpen: boolean) => {
    if (!isApplyingTap.current) setOpen(nextOpen);
  };

  return { onRadixOpenChange, touchTap };
}
