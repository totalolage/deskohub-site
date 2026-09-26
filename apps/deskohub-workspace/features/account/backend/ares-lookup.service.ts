import { Context, Data, Effect, Layer, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

const aresCompanyEndpoint = (ico: string) =>
  `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${encodeURIComponent(ico)}`;

export const aresCompanyLookupUrl = aresCompanyEndpoint;

const aresLookupTimeout = "5 seconds";

/**
 * The three neutral outcomes of a business registry lookup. Failures carry no
 * provider detail: the caller localizes them from the tag alone, so raw
 * registry payloads and transport errors can never reach users or logs.
 */
export type AresLookupFailure = Data.TaggedEnum<{
  /** Not exactly eight digits or a failed mod-11 check digit. */
  InvalidIco: Record<never, never>;
  /** The registry answered that no company exists for this ID. */
  NotFound: Record<never, never>;
  /** Timeout, network, rate-limit, unexpected status, or bad payload. */
  Unavailable: Record<never, never>;
}>;

export const AresLookupFailure = Data.taggedEnum<AresLookupFailure>();

/** Structured registered seat (`sidlo`) address fields, absent when unknown. */
export type AresSidlo = {
  readonly ulice?: string;
  readonly cisloDomovni?: string;
  readonly cisloOrientacni?: string;
  readonly castObce?: string;
  readonly obec?: string;
  readonly psc?: string;
  /** Registry state code; `"203"` means Czechia. */
  readonly statKod?: string;
};

/** Narrow verified ARES company record with absent values omitted. */
export type AresCompany = {
  readonly ico: string;
  readonly obchodniJmeno: string;
  readonly dic?: string;
  readonly sidlo?: AresSidlo;
};

/**
 * Czech IČO validity, the standard variant: exactly eight digits and the
 * check digit `(11 − (weighted sum mod 11)) mod 10`, where the first seven
 * digits are weighted 8 down to 2.
 */
export const isValidCzechCompanyIco = (ico: string): boolean => {
  if (!/^\d{8}$/.test(ico)) return false;
  const digits = [...ico].map(Number);
  const weightedSum = digits
    .slice(0, 7)
    .reduce((sum, digit, index) => sum + digit * (8 - index), 0);
  return (11 - (weightedSum % 11)) % 10 === digits[7];
};

const aresOptionalText = Schema.optional(Schema.String);
const aresOptionalNumberOrText = Schema.optional(
  Schema.Union([Schema.String, Schema.Number])
);

const aresSidloSchema = Schema.Struct({
  nazevUlice: aresOptionalText,
  cisloDomovni: aresOptionalNumberOrText,
  cisloOrientacni: aresOptionalNumberOrText,
  cisloOrientacniPismeno: aresOptionalText,
  nazevCastiObce: aresOptionalText,
  nazevObce: aresOptionalText,
  psc: aresOptionalNumberOrText,
  kodStatu: aresOptionalText,
});

const aresCompanySchema = Schema.Struct({
  ico: Schema.String,
  obchodniJmeno: Schema.String,
  dic: aresOptionalText,
  sidlo: Schema.optional(aresSidloSchema),
});

const asText = (value: string | number | undefined): string | undefined =>
  value === undefined ? undefined : String(value);

const asNonEmptyText = (
  value: string | number | undefined
): string | undefined => {
  const text = asText(value);
  return text ? text : undefined;
};

const decodeAresSidlo = (
  rawSidlo: Schema.Schema.Type<typeof aresSidloSchema>
): AresSidlo => ({
  ulice: asNonEmptyText(rawSidlo.nazevUlice),
  cisloDomovni: asNonEmptyText(rawSidlo.cisloDomovni),
  cisloOrientacni:
    asNonEmptyText(rawSidlo.cisloOrientacni) === undefined
      ? asNonEmptyText(rawSidlo.cisloOrientacniPismeno)
      : [
          asText(rawSidlo.cisloOrientacni),
          asText(rawSidlo.cisloOrientacniPismeno),
        ]
          .filter((part) => part !== undefined)
          .join(""),
  castObce: asNonEmptyText(rawSidlo.nazevCastiObce),
  obec: asNonEmptyText(rawSidlo.nazevObce),
  psc: asNonEmptyText(rawSidlo.psc),
  statKod: asNonEmptyText(rawSidlo.kodStatu),
});

const decodeAresCompany = (
  raw: Schema.Schema.Type<typeof aresCompanySchema>
): AresCompany => {
  const company: AresCompany = {
    ico: raw.ico,
    obchodniJmeno: raw.obchodniJmeno,
    dic: asNonEmptyText(raw.dic),
  };
  if (raw.sidlo !== undefined) {
    return { ...company, sidlo: decodeAresSidlo(raw.sidlo) };
  }
  return company;
};

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

const czechSeatStateCode = "203";

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
      company.obchodniJmeno,
      billingFieldMaximums.companyName
    ),
    companyId: fitWithin(company.ico, billingFieldMaximums.companyId),
    vatId: fitWithin(company.dic, billingFieldMaximums.vatId),
    addressLine1: fitWithin(addressLine1, billingFieldMaximums.addressLine1),
    addressLine2: fitWithin(sidlo?.castObce, billingFieldMaximums.addressLine2),
    city: fitWithin(sidlo?.obec, billingFieldMaximums.city),
    zip: fitWithin(sidlo?.psc, billingFieldMaximums.zip),
    country:
      sidlo === undefined ||
      sidlo.statKod === undefined ||
      sidlo.statKod === czechSeatStateCode
        ? "CZ"
        : undefined,
  };
};

interface IAresLookupService {
  readonly lookup: (
    ico: string
  ) => Effect.Effect<AresCompany, AresLookupFailure>;
}

/**
 * Looks up a Czech company in the official public ARES registry by its IČO.
 * One provider request per invocation, no API key, no local copy of registry
 * data.
 */
export class AresLookupService extends Context.Service<
  AresLookupService,
  IAresLookupService
>()("@deskohub-workspace/account/AresLookupService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;

      const lookup = Effect.fn("AresLookupService.lookup")((ico: string) =>
        Effect.suspend(() =>
          isValidCzechCompanyIco(ico)
            ? httpClient
                .execute(HttpClientRequest.get(aresCompanyEndpoint(ico)))
                .pipe(
                  Effect.flatMap((response) =>
                    response.status === 404
                      ? Effect.fail(AresLookupFailure.NotFound())
                      : Effect.succeed(response)
                  ),
                  Effect.filterOrFail(
                    (response) =>
                      response.status >= 200 && response.status < 300,
                    () => AresLookupFailure.Unavailable()
                  ),
                  Effect.flatMap(
                    HttpClientResponse.schemaBodyJson(aresCompanySchema)
                  ),
                  Effect.map(decodeAresCompany),
                  Effect.timeout(aresLookupTimeout),
                  Effect.catch(
                    (failure): Effect.Effect<never, AresLookupFailure> =>
                      AresLookupFailure.$is("NotFound")(failure)
                        ? Effect.fail(failure)
                        : Effect.logWarning("ARES company lookup failed").pipe(
                            Effect.annotateLogs({ registry: "ares.gov.cz" }),
                            Effect.andThen(
                              Effect.fail(AresLookupFailure.Unavailable())
                            )
                          )
                  )
                )
            : Effect.fail(AresLookupFailure.InvalidIco())
        )
      );

      return { lookup };
    })
  );

  static Live = this.Default.pipe(Layer.provide(FetchHttpClient.layer));
}
