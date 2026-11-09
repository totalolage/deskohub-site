"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import type { VariantProps } from "class-variance-authority";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type * as React from "react";
import { fieldTriggerVariants } from "@/shared/components/ui/field-trigger";
import { cn } from "@/shared/utils";

const Select = SelectPrimitive.Root;

const SelectValue = SelectPrimitive.Value;

interface SelectTriggerProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
    VariantProps<typeof fieldTriggerVariants> {
  ref?: React.Ref<React.ComponentRef<typeof SelectPrimitive.Trigger>>;
}

function SelectTrigger({
  className,
  children,
  variant,
  ref,
  ...props
}: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      data-slot="select-trigger"
      className={cn(
        fieldTriggerVariants({ variant }),
        "justify-between [&>span]:min-w-0 [&>span]:truncate",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 text-navy-blue/60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

interface SelectScrollUpButtonProps
  extends React.ComponentPropsWithoutRef<
    typeof SelectPrimitive.ScrollUpButton
  > {
  ref?: React.Ref<React.ComponentRef<typeof SelectPrimitive.ScrollUpButton>>;
}

function SelectScrollUpButton({
  className,
  ref,
  ...props
}: SelectScrollUpButtonProps) {
  return (
    <SelectPrimitive.ScrollUpButton
      ref={ref}
      className={cn(
        "flex cursor-default items-center justify-center py-1 text-navy-blue",
        className
      )}
      {...props}
    >
      <ChevronUp className="h-4 w-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

interface SelectScrollDownButtonProps
  extends React.ComponentPropsWithoutRef<
    typeof SelectPrimitive.ScrollDownButton
  > {
  ref?: React.Ref<React.ComponentRef<typeof SelectPrimitive.ScrollDownButton>>;
}

function SelectScrollDownButton({
  className,
  ref,
  ...props
}: SelectScrollDownButtonProps) {
  return (
    <SelectPrimitive.ScrollDownButton
      ref={ref}
      className={cn(
        "flex cursor-default items-center justify-center py-1 text-navy-blue",
        className
      )}
      {...props}
    >
      <ChevronDown className="h-4 w-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName;

interface SelectContentProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> {
  ref?: React.Ref<React.ComponentRef<typeof SelectPrimitive.Content>>;
}

function SelectContent({
  className,
  children,
  position = "popper",
  ref,
  ...props
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        data-slot="select-content"
        className={cn(
          "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-[1.5rem] border border-navy-blue/12 bg-white text-navy-blue shadow-[0_24px_80px_-36px_rgba(0,2,79,0.65)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}
SelectContent.displayName = SelectPrimitive.Content.displayName;

interface SelectItemProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> {
  ref?: React.Ref<React.ComponentRef<typeof SelectPrimitive.Item>>;
}

function SelectItem({ className, children, ref, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-xl py-2 pl-8 pr-2 text-sm text-navy-blue outline-none hover:bg-navy-blue/5 focus:bg-navy-blue/5 focus:text-navy-blue data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4 text-burned-orange" />
        </SelectPrimitive.ItemIndicator>
      </span>

      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectGroup = SelectPrimitive.Group;

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(
        "px-2 pt-2 pb-1 font-semibold text-[0.7rem] text-navy-blue/55 uppercase tracking-[0.12em]",
        className
      )}
      {...props}
    />
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
};
