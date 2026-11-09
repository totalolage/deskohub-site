"use client";

import { useFormContext } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";

type ServiceDateFormValues = {
  readonly serviceDateFrom: string;
  readonly serviceDateUntil: string;
};

/**
 * The first and last reservation start date a discount code applies to. Both
 * stay empty for a code that applies to any date.
 */
export function DiscountCodeServiceDateFields({
  fromId,
  untilId,
}: {
  readonly fromId: string;
  readonly untilId: string;
}) {
  const locale = useRouteLocale();
  const { control } = useFormContext<ServiceDateFormValues>();

  return (
    <div className="grid gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={control}
          name="serviceDateFrom"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel htmlFor={fromId}>
                {m.discountsServiceDateFromLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id={fromId}
                  type="date"
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="serviceDateUntil"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel htmlFor={untilId}>
                {m.discountsServiceDateUntilLabel({}, { locale })}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id={untilId}
                  type="date"
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <p className="text-xs leading-5 text-navy-blue/70">
        {m.discountsServiceDatesHint({}, { locale })}
      </p>
    </div>
  );
}
