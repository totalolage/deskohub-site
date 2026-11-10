"use client";

import { useFormContext } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { FormDateInput } from "@/shared/components/date-time/form-fields";
import {
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";

type ServiceDateFormValues = {
  readonly serviceDateFrom: string;
  readonly serviceDateUntil: string;
};

/**
 * The first and last reservation start date a discount code applies to. Both
 * stay empty for a code that applies to any date. The pair sits side by side
 * at every width.
 */
export function DiscountCodeServiceDateFields() {
  const locale = useRouteLocale();
  const { control } = useFormContext<ServiceDateFormValues>();

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 items-start gap-4">
        <FormField
          control={control}
          name="serviceDateFrom"
          render={({ field }) => (
            <FormItem className="min-w-0">
              <FormLabel>
                {m.discountsServiceDateFromLabel({}, { locale })}
              </FormLabel>
              <FormDateInput
                {...field}
                label={m.discountsServiceDateFromLabel({}, { locale })}
              />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="serviceDateUntil"
          render={({ field }) => (
            <FormItem className="min-w-0">
              <FormLabel>
                {m.discountsServiceDateUntilLabel({}, { locale })}
              </FormLabel>
              <FormDateInput
                {...field}
                label={m.discountsServiceDateUntilLabel({}, { locale })}
              />
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
