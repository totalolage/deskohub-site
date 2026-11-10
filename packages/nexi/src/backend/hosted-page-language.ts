import { PaymentSession } from "../generated/effect.gen";

/** A language the Nexi hosted payment page shows its text in. */
export type HostedPageLanguage = PaymentSession["language"];

const hostedPageLanguages: ReadonlySet<string> = new Set(
  PaymentSession.fields.language.literals
);

const isHostedPageLanguage = (value: string): value is HostedPageLanguage =>
  hostedPageLanguages.has(value);

/**
 * The hosted payment page language for an ISO 639-2 code, such as a locale's
 * `nexiLanguage`. Nexi documents no behaviour for a language outside its
 * table, so the page shows English for one.
 */
export const toHostedPageLanguage = (
  nexiLanguage: string
): HostedPageLanguage => {
  const language = nexiLanguage.toUpperCase();
  return isHostedPageLanguage(language) ? language : "ENG";
};
