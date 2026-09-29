import type { EkonomickySubjekt } from "@deskohub/ares";
import { Option, Schema } from "effect";
import { customerProfileBusinessBillingFields } from "@/features/account/contracts";

type BusinessBillingFields = typeof customerProfileBusinessBillingFields;

/**
 * The business billing fields a verified ARES company can fill in. Every
 * field is optional because the registry only omits what it cannot verify.
 */
export type AresBusinessBillingDraft = {
  readonly [Key in keyof BusinessBillingFields]?: Extract<
    BusinessBillingFields[Key]["Type"],
    string
  >;
};

/**
 * Decodes one registry value through its billing field schema, so trimming
 * and maximum-length enforcement come from the shared profile contract. A
 * value that is absent, blank, or fails the schema (for example overlength)
 * is omitted, never truncated, so a saved profile can never silently distort
 * public registry data.
 */
const billingDraftField = <Key extends keyof BusinessBillingFields>(
  key: Key
): ((value: string | undefined) => string | undefined) => {
  const decode = Schema.decodeUnknownOption(
    customerProfileBusinessBillingFields[key]
  );
  return (value) => {
    const decoded = Option.getOrUndefined(decode(value));
    return decoded === "" ? undefined : decoded;
  };
};

const companyName = billingDraftField("companyName");
const companyId = billingDraftField("companyId");
const vatId = billingDraftField("vatId");
const addressLine1 = billingDraftField("addressLine1");
const addressLine2 = billingDraftField("addressLine2");
const city = billingDraftField("city");
const zip = billingDraftField("zip");
const seatCountry = billingDraftField("country");

/**
 * The only seat-country code the draft fills in. The ARES OpenAPI contract
 * types the seat's `kodStatu` as a string over the `Stat` codelist
 * (ciselnikKod: Stat), whose documented Czechia entry is the code `"CZ"`.
 * Any other value — including an absent or unknown one — leaves the country
 * to the customer instead of silently defaulting to Czechia.
 */
const czechSeatStateCode = "CZ";

const formatHouseNumber = (
  sidlo: EkonomickySubjekt["sidlo"]
): string | undefined => {
  const houseNumber = sidlo?.cisloDomovni;
  const orientationNumber = sidlo?.cisloOrientacni;
  let number: string | undefined;
  if (houseNumber === undefined) {
    number =
      orientationNumber === undefined ? undefined : String(orientationNumber);
  } else if (orientationNumber === undefined) {
    number = String(houseNumber);
  } else {
    number = `${houseNumber}/${orientationNumber}`;
  }
  if (number === undefined) return undefined;
  const orientationLetter = sidlo?.cisloOrientacniPismeno;
  return orientationLetter === undefined
    ? number
    : `${number}${orientationLetter}`;
};

const decodeStreetName = Schema.decodeUnknownOption(
  customerProfileBusinessBillingFields.addressLine1
);

const joinAddressLine1 = (
  sidlo: EkonomickySubjekt["sidlo"]
): string | undefined => {
  const houseNumber = formatHouseNumber(sidlo);
  const rawStreetName = sidlo?.nazevUlice;
  if (rawStreetName === undefined) return houseNumber;
  // Normalize the street through the shared field schema BEFORE joining, so
  // padded registry whitespace cannot survive inside the joined line. An
  // overlength street can only fail here, so it omits the whole line; a
  // blank street counts as absent and leaves just the house number.
  const streetName = Option.getOrUndefined(decodeStreetName(rawStreetName));
  if (streetName === undefined) return undefined;
  if (streetName === "") return houseNumber;
  return houseNumber === undefined
    ? streetName
    : `${streetName} ${houseNumber}`;
};

/**
 * Maps a verified ARES company onto the existing business billing profile
 * fields. Only billing fields are filled; identity and personal fields are
 * never auto-completed, and the service already guarantees a nonblank
 * identity and company name.
 */
export const toAresBusinessBillingDraft = (
  company: EkonomickySubjekt
): AresBusinessBillingDraft => {
  const sidlo = company.sidlo;
  return {
    companyName: companyName(company.obchodniJmeno),
    companyId: companyId(company.ico),
    vatId: vatId(company.dic),
    addressLine1: addressLine1(joinAddressLine1(sidlo)),
    addressLine2: addressLine2(sidlo?.nazevCastiObce),
    city: city(sidlo?.nazevObce),
    zip: zip(sidlo?.psc === undefined ? undefined : String(sidlo.psc)),
    // The raw generated record keeps registry whitespace on kodStatu (for
    // example " CZ "), so the seat code is normalized through the shared
    // country field schema before the exact-CZ comparison. Absent, blank,
    // unknown, or invalid codes never produce a country.
    country:
      seatCountry(sidlo?.kodStatu) === czechSeatStateCode
        ? czechSeatStateCode
        : undefined,
  };
};
