import { z } from "zod/v4";
import { type Locale, locales } from "@/features/i18n";
import { getReservationSchema } from "@/features/reservation/schemas/reservation";

export const getSubmitReservationSchema = () =>
  z.object({
    locale: z.enum(locales),
    reservation: getReservationSchema(),
  });

export type SubmitReservationInput = z.output<
  ReturnType<typeof getSubmitReservationSchema>
>;

export const getSubmitReservationCheckoutLocale = (
  input: Pick<SubmitReservationInput, "locale">,
  _contextLocale: Locale
): Locale => input.locale;
