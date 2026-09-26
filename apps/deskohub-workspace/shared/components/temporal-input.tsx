"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";

export function TemporalInput({
  defaultValue,
  id,
  label,
  name,
  type,
}: {
  readonly defaultValue?: string;
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly type: "date" | "datetime-local";
}) {
  const canonicalDefault = defaultValue ?? "";
  const [value, setValue] = useState(canonicalDefault);
  const hiddenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form) return;
    const handleReset = () => setValue(canonicalDefault);
    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, [canonicalDefault]);

  const updateValue = useCallback((next: string) => {
    setValue(next);
    const hidden = hiddenRef.current;
    if (!hidden) return;
    hidden.value = next;
    hidden.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);

  const syncEditorValue = (event: React.FormEvent<HTMLInputElement>) => {
    // Native date/time editors report badInput with an empty value while a
    // segmented edit is incomplete. Keep the last committed value instead of
    // clearing it, and keep the incomplete edit off the owning form.
    if (!event.currentTarget.validity.valid) {
      event.stopPropagation();
      return;
    }
    updateValue(event.currentTarget.value);
  };

  const [dateSegment = "", timeSegment] = value.split("T");
  const showTime = type === "datetime-local" && Boolean(timeSegment);

  return (
    <>
      <input
        aria-hidden="true"
        name={name}
        readOnly
        ref={hiddenRef}
        tabIndex={-1}
        type="hidden"
        value={value}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            aria-label={label}
            className="min-h-12 w-full justify-between rounded-[1.1rem] border border-navy-blue/12 bg-white px-4 py-2 text-left text-base font-normal normal-case hover:border-navy-blue/40"
            id={id}
            type="button"
            variant="secondary"
          >
            {value ? (
              <span className="flex flex-col items-start gap-0.5">
                <span>{dateSegment}</span>
                {showTime && <span>{timeSegment}</span>}
              </span>
            ) : (
              "Not set"
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(22rem,calc(100vw-2rem))] p-3"
          collisionPadding={16}
        >
          <div className="grid gap-2">
            <Input
              aria-label={`Edit ${label}`}
              className="min-w-0"
              onInput={syncEditorValue}
              type={type}
              value={value}
            />
            <Button
              aria-label={`Clear ${label}`}
              className="justify-self-start"
              onClick={() => updateValue("")}
              type="button"
              variant="ghost"
            >
              Clear
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
