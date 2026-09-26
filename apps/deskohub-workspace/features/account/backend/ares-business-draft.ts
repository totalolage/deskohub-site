import type { AresCompany, AresSidlo } from "@deskohub/ares";

/**
 * Maximum lengths of the business billing fields in the account profile
 * contract. A verified registry value that does not fit is omitted, never
 * truncated, so a saved profile can never silently distort public registry
 * data.
 */
const billingFieldMaximums = {
  companyName: 200,
  companyId: 32,
  vatId: 32,
  addressLine1: 200,
  addressLine2: 200,
  city: 100,
  zip: 20,
  country: 2,
} as const;

const fitWithin = (value: string | undefined, maximumLength: number) =>
  value !== undefined && value.length <= maximumLength ? value : undefined;

export type AresBusinessBillingDraft = {
  readonly [Key in keyof typeof billingFieldMaximums]?: string;
};

/**
 * The only seat-country code the draft fills in. The ARES OpenAPI contract
 * types `Adresa.kodStatu` as a string over the `Stat` codelist
 * (ciselnikKod: Stat), whose documented Czechia entry is the code `"CZ"`.
 * Any other value — including an absent or unknown one — leaves the country
 * to the customer instead of silently defaulting to Czechia.
 */
const czechSeatStateCode = "CZ";

const nonEmptyText = (value: string): string | undefined => {
  const text = value.trim();
  return text ? text : undefined;
};

const joinAddressLine1 = (sidlo: AresSidlo): string | undefined => {
  if (sidlo.ulice === undefined) return formatHouseNumber(sidlo);
  const houseNumber = formatHouseNumber(sidlo);
  return houseNumber === undefined
    ? sidlo.ulice
    : `${sidlo.ulice} ${houseNumber}`;
};

const formatHouseNumber = (sidlo: AresSidlo): string | undefined => {
  if (sidlo.cisloDomovni === undefined) return sidlo.cisloOrientacni;
  return sidlo.cisloOrientacni === undefined
    ? sidlo.cisloDomovni
    : `${sidlo.cisloDomovni}/${sidlo.cisloOrientacni}`;
};

/**
 * Maps a verified ARES company onto the existing business billing profile
 * fields. Only billing fields are filled; identity and personal fields are
 * never auto-completed.
 */
export const toAresBusinessBillingDraft = (
  company: AresCompany
): AresBusinessBillingDraft => {
  const sidlo = company.sidlo;
  const addressLine1 =
    sidlo === undefined ? undefined : joinAddressLine1(sidlo);
  return {
    companyName: fitWithin(
      nonEmptyText(company.obchodniJmeno),
      billingFieldMaximums.companyName
    ),
    companyId: fitWithin(
      nonEmptyText(company.ico),
      billingFieldMaximums.companyId
    ),
    vatId: fitWithin(
      company.dic === undefined ? undefined : nonEmptyText(company.dic),
      billingFieldMaximums.vatId
    ),
    addressLine1: fitWithin(addressLine1, billingFieldMaximums.addressLine1),
    addressLine2: fitWithin(sidlo?.castObce, billingFieldMaximums.addressLine2),
    city: fitWithin(sidlo?.obec, billingFieldMaximums.city),
    zip: fitWithin(sidlo?.psc, billingFieldMaximums.zip),
    country:
      sidlo?.statKod === czechSeatStateCode ? czechSeatStateCode : undefined,
  };
};
