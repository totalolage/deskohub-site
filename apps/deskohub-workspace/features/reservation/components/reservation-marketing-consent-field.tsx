"use client";

import Link from "next/link";
import { useFormContext } from "react-hook-form";
import { type Locale, m } from "@/features/i18n";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";

type ReservationMarketingConsentFieldProps = {
  readonly id?: string;
  readonly locale: Locale;
};

export function ReservationMarketingConsentField({
  id = "reservation-marketing-consent",
  locale,
}: ReservationMarketingConsentFieldProps) {
  const { control } = useFormContext<{ readonly marketingConsent: boolean }>();

  return (
    <FormField
      control={control}
      name="marketingConsent"
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
              {m.reservationMarketingConsentBefore({}, { locale })}{" "}
              <Link
                className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
                href={`/${locale}/marketing-communications`}
                prefetch={false}
                rel="noreferrer"
                target="_blank"
              >
                {m.reservationMarketingConsentLinkLabel({}, { locale })}
              </Link>
              {m.reservationMarketingConsentAfter({}, { locale })}
            </span>
          </label>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
