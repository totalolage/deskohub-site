"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  type ComponentProps,
  createContext,
  use,
  useRef,
  useState,
} from "react";
import { cn } from "@/shared/utils";

type TooltipTouchTap = {
  /** Starts a trigger press; only touch presses toggle the tooltip on tap. */
  readonly press: (pointerType: string) => void;
  readonly cancelPress: () => void;
  /** Settles the latest touch press when its click arrives. */
  readonly tap: (clickDetail: number) => void;
};

const TooltipTouchTapContext = createContext<TooltipTouchTap | null>(null);

function TooltipProvider({
  delayDuration = 200,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

/**
 * Radix opens a tooltip on the focus a touch tap emulates and closes it on the
 * tap's click, so on touchscreens it only flashes. A touch tap on the trigger
 * toggles the tooltip instead; outside taps, scrolling, and Escape dismiss it.
 */
function Tooltip({
  defaultOpen = false,
  onOpenChange,
  open: openProp,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  /** Open state the trigger's latest touch press settles on when it taps. */
  const tapOpen = useRef<boolean | undefined>(undefined);
  /** Whether Radix's close on the tap's click is being ignored. */
  const isApplyingTap = useRef(false);
  const setOpen = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
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

  return (
    <TooltipTouchTapContext value={touchTap}>
      <TooltipPrimitive.Root
        {...props}
        onOpenChange={(nextOpen) => {
          if (!isApplyingTap.current) setOpen(nextOpen);
        }}
        open={open}
      />
    </TooltipTouchTapContext>
  );
}

function TooltipTrigger({
  onClick,
  onPointerCancel,
  onPointerDown,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const touchTap = use(TooltipTouchTapContext);
  if (!touchTap) throw new Error("TooltipTrigger must be used within Tooltip");

  return (
    <TooltipPrimitive.Trigger
      {...props}
      onClick={(event) => {
        onClick?.(event);
        touchTap.tap(event.detail);
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event);
        touchTap.cancelPress();
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        touchTap.press(event.pointerType);
      }}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-xl border border-navy-blue/12 bg-white px-3 py-2 text-sm text-navy-blue shadow-lg outline-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-tooltip-content-transform-origin)",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
