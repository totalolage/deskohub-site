import { Context, Data, Effect, Layer, Predicate } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import {
  type AresClient,
  type EkonomickySubjekt,
  make,
} from "../generated/effect.gen";

const aresBaseUrl = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest";

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
  /** Registry state code; the documented Czechia code is `"CZ"`. */
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

/**
 * The registry base URL is pinned here, never taken from callers, so the
 * generated client can only ever address the official public host.
 */
const makeAresClient = (httpClient: HttpClient.HttpClient): AresClient =>
  make(httpClient, {
    transformClient: (client) =>
      Effect.succeed(
        client.pipe(
          HttpClient.mapRequestInput((request) =>
            request.pipe(HttpClientRequest.prependUrl(aresBaseUrl))
          )
        )
      ),
  });

const isNotFoundResponse = (error: unknown): boolean =>
  Predicate.isTagged(error, "VratEkonomickySubjekt404");

const reportUnavailable = Effect.logWarning("ARES company lookup failed").pipe(
  Effect.annotateLogs({ registry: "ares.gov.cz" }),
  Effect.andThen(Effect.fail(AresLookupFailure.Unavailable()))
);

interface IAresLookupService {
  readonly lookup: (
    ico: string
  ) => Effect.Effect<AresCompany, AresLookupFailure>;
}

/**
 * Looks up a Czech company in the official public ARES registry by its IČO.
 * One provider request per invocation, no API key, no local copy of registry
 * data. The provider payload is validated by the generated OpenAPI client and
 * then projected onto the neutral domain types above.
 */
export class AresLookupService extends Context.Service<
  AresLookupService,
  IAresLookupService
>()("@deskohub/ares/AresLookupService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;

      const lookup = Effect.fn("AresLookupService.lookup")((ico: string) =>
        Effect.suspend(() =>
          isValidCzechCompanyIco(ico)
            ? makeAresClient(httpClient)
                .vratEkonomickySubjekt(encodeURIComponent(ico), undefined)
                .pipe(
                  Effect.timeout(aresLookupTimeout),
                  Effect.map((subject) => projectCompany(subject)),
                  // The registry must answer for the requested company: a
                  // mismatched or blank identity is a provider anomaly, not
                  // a match, so it degrades to the sanitized unavailable
                  // outcome instead of handing callers wrong data.
                  Effect.filterOrFail(
                    (company) =>
                      company.ico === ico && company.obchodniJmeno.length > 0,
                    () => AresLookupFailure.Unavailable()
                  ),
                  Effect.catch(
                    (failure): Effect.Effect<never, AresLookupFailure> =>
                      isNotFoundResponse(failure)
                        ? Effect.fail(AresLookupFailure.NotFound())
                        : reportUnavailable
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

const aresText = (value: string | number | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
};

type AresAdresa = NonNullable<EkonomickySubjekt["sidlo"]>;

const projectSidlo = (sidlo: AresAdresa): AresSidlo => ({
  ulice: aresText(sidlo.nazevUlice),
  cisloDomovni: aresText(sidlo.cisloDomovni),
  cisloOrientacni:
    aresText(sidlo.cisloOrientacni) === undefined
      ? aresText(sidlo.cisloOrientacniPismeno)
      : [sidlo.cisloOrientacni, sidlo.cisloOrientacniPismeno]
          .filter((part) => aresText(part) !== undefined)
          .map((part) => String(part).trim())
          .join(""),
  castObce: aresText(sidlo.nazevCastiObce),
  obec: aresText(sidlo.nazevObce),
  psc: aresText(sidlo.psc),
  statKod: aresText(sidlo.kodStatu),
});

const projectCompany = (subject: EkonomickySubjekt): AresCompany => {
  const company: AresCompany = {
    ico: aresText(subject.ico) ?? "",
    obchodniJmeno: aresText(subject.obchodniJmeno) ?? "",
    dic: aresText(subject.dic),
  };
  if (subject.sidlo !== undefined) {
    return { ...company, sidlo: projectSidlo(subject.sidlo) };
  }
  return company;
};
