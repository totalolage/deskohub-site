"use client";

import type { ReactNode } from "react";
import { useFormContext } from "react-hook-form";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";

type ReservationConsentFormValues = {
  readonly legalConsent: boolean;
  readonly marketingConsent: boolean;
};

type ReservationConsentFieldProps = {
  readonly children: ReactNode;
  readonly id: string;
  readonly name: keyof ReservationConsentFormValues;
};

export function ReservationConsentField({
  children,
  id,
  name,
}: ReservationConsentFieldProps) {
  const { control } = useFormContext<ReservationConsentFormValues>();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <label
            className="flex cursor-pointer items-start gap-3 rounded-[1.35rem] border border-navy-blue/10 bg-navy-blue/2.5 p-4"
            htmlFor={id}
          >
            <FormControl>
              <Checkbox
                checked={field.value}
                className="mt-1"
                id={id}
                onBlur={field.onBlur}
                onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                ref={field.ref}
              />
            </FormControl>
            <span className="text-sm leading-6 text-navy-blue/66">
              {children}
            </span>
          </label>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
