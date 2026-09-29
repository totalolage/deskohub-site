"use client";

import Interpolate from "@doist/react-interpolate";
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
import { ReservationFormLegalCard } from "./reservation-form-legal-card";

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
          <label className="block cursor-pointer" htmlFor={id}>
            <ReservationFormLegalCard
              indicator={
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    id={id}
                    onBlur={field.onBlur}
                    onCheckedChange={(checked) =>
                      field.onChange(Boolean(checked))
                    }
                    ref={field.ref}
                  />
                </FormControl>
              }
            >
              <Interpolate
                string={m.reservationMarketingConsent({}, { locale })}
                mapping={{
                  marketingConsent: (label) => (
                    <Link
                      className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
                      href={`/${locale}/marketing-communications`}
                      prefetch={false}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {label}
                    </Link>
                  ),
                }}
              />
            </ReservationFormLegalCard>
          </label>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
