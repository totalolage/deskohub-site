"use client";

import * as React from "react";
import { type UseControllerProps, useController } from "react-hook-form";
import { PhoneInput, type PhoneInputProps } from "./phone-input";

export interface FormPhoneInputProps<T extends Record<string, unknown>>
  extends Omit<PhoneInputProps, "value" | "onChange" | "onNormalizedChange">,
    UseControllerProps<T> {
  onNormalizedChange?: (normalizedValue: string | null) => void;
}

export function FormPhoneInput<T extends Record<string, unknown>>({
  name,
  control,
  rules,
  shouldUnregister,
  defaultValue,
  onNormalizedChange,
  ...phoneInputProps
}: FormPhoneInputProps<T>) {
  const {
    field: { onChange, onBlur, value, ref },
    fieldState: { error },
  } = useController({
    name,
    control,
    rules,
    shouldUnregister,
    defaultValue,
  });

  const handleChange = React.useCallback(
    (newValue: string) => {
      onChange(newValue);
    },
    [onChange]
  );

  const handleNormalizedChange = React.useCallback(
    (normalizedValue: string | null) => {
      if (onNormalizedChange) {
        onNormalizedChange(normalizedValue);
      }
    },
    [onNormalizedChange]
  );

  return (
    <PhoneInput
      ref={ref}
      value={value || ""}
      onChange={handleChange}
      onNormalizedChange={handleNormalizedChange}
      onBlur={onBlur}
      variant={error ? "error" : "default"}
      {...phoneInputProps}
    />
  );
}
