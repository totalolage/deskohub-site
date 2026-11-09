"use client";

import { type ComponentProps, useState } from "react";
import { Input } from "@/shared/components/ui/input";

export function OfficeDayCountInput({
  maximum,
  onBlur,
  onChange,
  value,
  ...props
}: Omit<ComponentProps<typeof Input>, "onChange" | "value"> & {
  readonly maximum: number;
  readonly onChange: (dayCount: number) => void;
  readonly value: number;
}) {
  // Keeps the visitor's raw text while editing so the field can be cleared and
  // retyped; the committed day count is clamped and the text resyncs on blur.
  const [draft, setDraft] = useState<string>();
  const clampDayCount = (dayCount: number) =>
    Math.min(Math.max(1, Math.trunc(dayCount)), maximum);

  return (
    <Input
      {...props}
      inputMode="numeric"
      max={maximum}
      min={1}
      onBlur={(event) => {
        setDraft(undefined);
        onBlur?.(event);
      }}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        const nextDayCount = Number(nextDraft);
        if (nextDraft.trim() !== "" && Number.isFinite(nextDayCount)) {
          onChange(clampDayCount(nextDayCount));
        }
      }}
      type="number"
      value={draft ?? value}
      required
    />
  );
}
