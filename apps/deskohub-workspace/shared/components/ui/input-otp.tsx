"use client";

import { OTPInput, OTPInputContext } from "input-otp";
import type * as React from "react";
import { useContext } from "react";
import { cn } from "@/shared/utils";

type InputOTPProps = React.ComponentProps<typeof OTPInput>;

function InputOTP({ className, containerClassName, ...props }: InputOTPProps) {
  return (
    <OTPInput
      autoComplete="one-time-code"
      inputMode="numeric"
      containerClassName={cn(
        "flex items-center gap-2 has-[:disabled]:opacity-50",
        containerClassName
      )}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  );
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center", className)} {...props} />;
}

function InputOTPSlot({
  index,
  invalid = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  readonly index: number;
  readonly invalid?: boolean;
}) {
  const inputOTPContext = useContext(OTPInputContext);
  const slot = inputOTPContext.slots[index];

  return (
    <div
      data-active={slot?.isActive}
      className={cn(
        "relative flex h-14 w-11 items-center justify-center rounded-xl border bg-white text-2xl font-semibold tabular-nums text-navy-blue transition",
        invalid ? "border-red-700/70" : "border-navy-blue/45",
        slot?.isActive &&
          "z-10 border-burned-orange ring-2 ring-burned-orange/70",
        className
      )}
      {...props}
    >
      {slot?.char}
      {slot?.hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-px animate-caret-blink bg-navy-blue" />
        </div>
      )}
    </div>
  );
}

function InputOTPSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "h-0.5 w-3 shrink-0 rounded-full bg-navy-blue/30",
        className
      )}
      {...props}
    />
  );
}

export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot };
