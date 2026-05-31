import { z } from "zod/v4";
import { type Locale, locales } from "@/features/i18n";

export const getSubmitReservationSchema = () =>
  z.object({
    locale: z.enum(locales),
    payStateToken: z.string().min(1),
    legalConsent: z.boolean().optional(),
  });

export type SubmitReservationInput = z.output<
  ReturnType<typeof getSubmitReservationSchema>
>;

export const getSubmitReservationCheckoutLocale = (
  input: Pick<SubmitReservationInput, "locale">,
  _contextLocale: Locale
): Locale => input.locale;
