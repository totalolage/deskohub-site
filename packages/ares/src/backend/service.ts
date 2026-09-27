import { Context, Data, Effect, Layer, Match, Predicate, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import {
  type AresClient,
  EkonomickySubjekt,
  make,
} from "../generated/effect.gen";

const aresBaseUrl = "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest";

const aresLookupTimeout = "5 seconds";

/**
 * The neutral outcomes of a business registry lookup. The failure is a
 * genuine Error tagged AresLookupFailure with a closed low-cardinality
 * reason and carries no provider detail: the caller localizes it from the
 * reason alone, so raw registry payloads and transport errors can never
 * reach users or logs.
 */
export class AresLookupFailure extends Data.TaggedError("AresLookupFailure")<{
  readonly reason: "InvalidIco" | "NotFound" | "Unavailable";
}> {}

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
  Effect.andThen(Effect.fail(new AresLookupFailure({ reason: "Unavailable" })))
);

/**
 * The generated record schema extended with a verified-subject check: the
 * registry must answer for the requested company with a non-blank trade
 * name. A mismatched or blank identity is a provider anomaly, not a match,
 * so callers never receive wrong data.
 */
const verifiedSubject = (ico: string) =>
  EkonomickySubjekt.check(
    Schema.makeFilter(
      (subject: EkonomickySubjekt) =>
        subject.ico === ico &&
        subject.obchodniJmeno !== undefined &&
        subject.obchodniJmeno.trim().length > 0,
      {
        identifier: "verifiedAresSubject",
        expected: `the company with IČO ${ico} and a non-blank trade name`,
      }
    )
  );

interface IAresLookupService {
  readonly lookup: (
    ico: string
  ) => Effect.Effect<EkonomickySubjekt, AresLookupFailure>;
}

/**
 * Looks up a Czech company in the official public ARES registry by its IČO.
 * One provider request per invocation, no API key, no local copy of registry
 * data. The provider payload is validated by the generated OpenAPI client
 * and then checked against the verified-subject schema above; on success the
 * generated registry record is returned as-is.
 */
export class AresLookupService extends Context.Service<
  AresLookupService,
  IAresLookupService
>()("@deskohub/ares/AresLookupService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;

      const lookup = Effect.fn("AresLookupService.lookup")(function* (
        ico: string
      ) {
        if (!isValidCzechCompanyIco(ico)) {
          return yield* new AresLookupFailure({ reason: "InvalidIco" });
        }

        const subject = yield* makeAresClient(httpClient)
          .vratEkonomickySubjekt(encodeURIComponent(ico), undefined)
          .pipe(
            Effect.timeout(aresLookupTimeout),
            Effect.catch(
              (failure): Effect.Effect<never, AresLookupFailure> =>
                Match.value(failure).pipe(
                  Match.when(isNotFoundResponse, () =>
                    Effect.fail(new AresLookupFailure({ reason: "NotFound" }))
                  ),
                  Match.orElse(() => reportUnavailable)
                )
            )
          );

        if (!Schema.is(verifiedSubject(ico))(subject)) {
          return yield* new AresLookupFailure({ reason: "Unavailable" });
        }

        return subject;
      });

      return { lookup };
    })
  );

  static Live = this.Default.pipe(Layer.provide(FetchHttpClient.layer));
}
