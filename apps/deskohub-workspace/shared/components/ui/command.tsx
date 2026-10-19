"use client";

import { Command as CommandPrimitive, useCommandState } from "cmdk";
import { Check, Search } from "lucide-react";
import type * as React from "react";
import { cn } from "@/shared/utils";
import { includesSearchText } from "@/shared/utils/text-case";

/**
 * Keeps items whose keywords, or value without keywords, contain the search,
 * ignoring case and accents. Items can then use an ID as their value.
 */
const keywordFilter = (value: string, search: string, keywords?: string[]) =>
  (keywords?.length ? keywords : [value]).some((text) =>
    includesSearchText(text, search)
  )
    ? 1
    : 0;

/**
 * A searchable list: type to filter, arrows to move, Enter to pick. Put it in
 * a `PopoverContent` with `p-0` for a combobox.
 */
function Command({
  className,
  filter = keywordFilter,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      filter={filter}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-[inherit] bg-white text-navy-blue",
        className
      )}
      {...props}
    />
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex items-center gap-2 border-navy-blue/10 border-b px-3"
    >
      <Search className="h-4 w-4 shrink-0 text-navy-blue/55" aria-hidden />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-navy-blue/55 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-72 scroll-py-1 overflow-y-auto overflow-x-hidden p-1",
        className
      )}
      {...props}
    />
  );
}

/**
 * The no-results message. Its status region stays mounted while the list is
 * open, so screen readers announce the message when a search empties the
 * list. Place it after `CommandList`: a listbox holds only options.
 */
function CommandEmpty({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const empty = useCommandState((state) => state.filtered.count === 0);
  return (
    <div
      data-slot="command-empty"
      role="status"
      className={cn(
        empty && "px-3 py-4 text-center text-navy-blue/65 text-sm",
        className
      )}
      {...props}
    >
      {empty && children}
    </div>
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn("overflow-hidden", className)}
      {...props}
    />
  );
}

/** An option; `selected` shows the check mark the select items use. */
function CommandItem({
  className,
  children,
  selected = false,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & {
  readonly selected?: boolean;
}) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-xl py-2 pr-2 pl-8 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-navy-blue/5 data-[disabled=true]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        {selected && (
          <Check className="h-4 w-4 text-burned-orange" aria-hidden />
        )}
      </span>
      {children}
    </CommandPrimitive.Item>
  );
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
};
