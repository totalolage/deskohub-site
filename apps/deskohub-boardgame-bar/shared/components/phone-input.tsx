"use client";

import type { CountryCode } from "libphonenumber-js";
import { Phone } from "lucide-react";
import * as React from "react";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils";
import {
  adoptsControlledPhoneValue,
  phoneInputVariant,
  phoneNumberFormattedOnBlur,
  phoneNumberValidity,
} from "./phone-number-entry";
import { PhoneValidityIcon } from "./phone-validity-icon";

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
      if (adoptsControlledPhoneValue({ value, displayValue, isFocused })) {
        setDisplayValue(value);
      }
    }, [value, isFocused, displayValue]);

    // Validate and notify parent of normalized value
    React.useEffect(() => {
      const validity = phoneNumberValidity(displayValue, countryCode);
      setIsValid(validity.isValid);

      if (onNormalizedChange) {
        onNormalizedChange(validity.normalized);
      }
    }, [displayValue, countryCode, onNormalizedChange]);

    const showValue = (newValue: string) => {
      setDisplayValue(newValue);

      if (onChange) {
        onChange(newValue);
      }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      showValue(e.target.value);
    };

    const handleFocus = () => {
      setIsFocused(true);
    };

    const handleBlur = () => {
      setIsFocused(false);

      // Format the number on blur if it's valid
      if (!formatOnBlur) return;
      const formatted = phoneNumberFormattedOnBlur(
        displayValue,
        countryCode,
        locale
      );
      if (formatted !== null) {
        showValue(formatted);
      }
    };

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
            variant={phoneInputVariant(variant, isValid)}
            className={cn(
              "pl-9",
              showValidation && isValid !== null && "pr-9",
              className
            )}
            {...props}
          />
          {showValidation && isValid !== null && (
            <PhoneValidityIcon isValid={isValid} />
          )}
        </div>
      </div>
    );
  }
);

PhoneInput.displayName = "PhoneInput";
