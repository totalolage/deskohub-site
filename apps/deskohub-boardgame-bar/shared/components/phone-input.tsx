"use client";

import { type CountryCode, isValidPhoneNumber } from "libphonenumber-js";
import { Check, Phone, X } from "lucide-react";
import * as React from "react";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils";
import {
  formatPhoneNumber,
  normalizePhoneNumber,
} from "@/shared/utils/phone-formatting";

export interface PhoneInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "onChange" | "value"
  > {
  value?: string;
  onChange?: (value: string) => void;
  onNormalizedChange?: (normalizedValue: string | null) => void;
  countryCode?: CountryCode;
  showValidation?: boolean;
  variant?: "default" | "error";
  formatOnBlur?: boolean;
}

export const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  (
    {
      value = "",
      onChange,
      onNormalizedChange,
      countryCode = "CZ",
      showValidation = false,
      variant,
      formatOnBlur = true,
      className,
      ...props
    },
    ref
  ) => {
    const locale = useLocale();
    const [displayValue, setDisplayValue] = React.useState(value);
    const [isFocused, setIsFocused] = React.useState(false);
    const [isValid, setIsValid] = React.useState<boolean | null>(null);

    // Update display value when value prop changes
    React.useEffect(() => {
      if (!isFocused && value !== displayValue) {
        setDisplayValue(value);
      }
    }, [value, isFocused, displayValue]);

    // Validate and notify parent of normalized value
    React.useEffect(() => {
      if (displayValue?.trim()) {
        const normalized = normalizePhoneNumber(displayValue, countryCode);
        const valid = isValidPhoneNumber(displayValue, countryCode);
        setIsValid(valid);

        if (onNormalizedChange) {
          onNormalizedChange(normalized);
        }
      } else {
        setIsValid(null);
        if (onNormalizedChange) {
          onNormalizedChange(null);
        }
      }
    }, [displayValue, countryCode, onNormalizedChange]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setDisplayValue(newValue);

      if (onChange) {
        onChange(newValue);
      }
    };

    const handleFocus = () => {
      setIsFocused(true);
    };

    const handleBlur = () => {
      setIsFocused(false);

      // Format the number on blur if it's valid
      if (formatOnBlur && displayValue && displayValue.trim()) {
        const normalized = normalizePhoneNumber(displayValue, countryCode);
        if (normalized) {
          const formatted = formatPhoneNumber(normalized, locale);
          setDisplayValue(formatted);
          if (onChange) {
            onChange(formatted);
          }
        }
      }
    };

    // Determine the actual variant based on validation
    const effectiveVariant =
      variant || (isValid === false ? "error" : "default");

    return (
      <div className="relative">
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={ref}
            type="tel"
            value={displayValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            variant={effectiveVariant}
            className={cn(
              "pl-9",
              showValidation && isValid !== null && "pr-9",
              className
            )}
            {...props}
          />
          {showValidation && isValid !== null && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {isValid ? (
                <Check
                  className="h-4 w-4 text-green-500"
                  aria-label="Valid phone number"
                />
              ) : (
                <X
                  className="h-4 w-4 text-red-500"
                  aria-label="Invalid phone number"
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);

PhoneInput.displayName = "PhoneInput";
