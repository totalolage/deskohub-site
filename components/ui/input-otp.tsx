"use client";

import { OTPInput, OTPInputContext } from "input-otp";
import { Dot } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputOTPProps {
  className?: string;
  containerClassName?: string;
  ref?: React.Ref<React.ComponentRef<typeof OTPInput>>;
  maxLength: number;
  children: React.ReactNode;
  value?: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  pattern?: string;
  pushPasswordManagerStrategy?: "increase-width" | "none";
  textAlign?: "left" | "center" | "right";
  noScriptCSSFallback?: string;
}

function InputOTP({
  className,
  containerClassName,
  ref,
  ...props
}: InputOTPProps) {
  return (
    <OTPInput
      ref={ref}
      containerClassName={cn(
        "flex items-center gap-2 has-[:disabled]:opacity-50",
        containerClassName
      )}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  );
}
InputOTP.displayName = "InputOTP";

export interface InputOTPGroupProps
  extends React.ComponentPropsWithoutRef<"div"> {
  ref?: React.Ref<React.ComponentRef<"div">>;
}

function InputOTPGroup({ className, ref, ...props }: InputOTPGroupProps) {
  return (
    <div ref={ref} className={cn("flex items-center", className)} {...props} />
  );
}
InputOTPGroup.displayName = "InputOTPGroup";

export interface InputOTPSlotProps
  extends React.ComponentPropsWithoutRef<"div"> {
  index: number;
  ref?: React.Ref<React.ComponentRef<"div">>;
}

function InputOTPSlot({ index, className, ref, ...props }: InputOTPSlotProps) {
  const inputOTPContext = React.useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = inputOTPContext.slots[index];

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center border-y border-r border-input text-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md",
        isActive && "z-10 ring-2 ring-ring ring-offset-background",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      )}
    </div>
  );
}
InputOTPSlot.displayName = "InputOTPSlot";

export interface InputOTPSeparatorProps
  extends React.ComponentPropsWithoutRef<"div"> {
  ref?: React.Ref<React.ComponentRef<"div">>;
}

function InputOTPSeparator({ ref, ...props }: InputOTPSeparatorProps) {
  return (
    <div ref={ref} className="flex items-center justify-center" {...props}>
      <Dot />
    </div>
  );
}
InputOTPSeparator.displayName = "InputOTPSeparator";

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
