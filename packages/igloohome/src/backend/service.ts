import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { IgloohomeRuntimeConfig } from "../config";
import { IgloohomeRequestError } from "../errors";
import type { IssuedHourlyAlgoPin, IssueHourlyAlgoPinInput } from "../types";
import { AlgoPinSchema, IgloohomePinIdSchema } from "../types";
import {
  IgloohomeAccessToken,
  makeIgloohomeClient,
  mapAlgoPinRequestError,
} from "./api";

const makeIgloohomeService = Effect.gen(function* () {
  const config = yield* IgloohomeRuntimeConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const accessToken = yield* IgloohomeAccessToken;

  const issueHourlyAlgoPin = Effect.fn("IgloohomeService.issueHourlyAlgoPin")(
    function* (input: IssueHourlyAlgoPinInput) {
      // Authenticate before the credential-creation timeout begins. A failure
      // here is definitively pre-request and must not be reported as ambiguous.
      const token = yield* accessToken.get;
      const client = makeIgloohomeClient({
        accessToken: token,
        config,
        httpClient,
      });
      const response = yield* client
        .createHourlyAlgoPin(encodeURIComponent(input.deviceId), {
          payload: {
            variance: 1,
            startDate: input.startsAt,
            endDate: input.endsAt,
            accessName: input.accessName,
          },
        })
        .pipe(
          Effect.timeoutOrElse({
            duration: config.apiTimeout,
            orElse: () =>
              Effect.fail(
                new IgloohomeRequestError({
                  operation: "issue_hourly_algopin",
                  outcome: "ambiguous",
                  message: "The Igloohome AlgoPIN request timed out.",
                })
              ),
          }),
          Effect.mapError(mapAlgoPinRequestError)
        );

      const pin = yield* Schema.decodeUnknownEffect(AlgoPinSchema)(
        response.pin
      ).pipe(
        Effect.mapError(
          () =>
            new IgloohomeRequestError({
              operation: "issue_hourly_algopin",
              outcome: "ambiguous",
              message: "Igloohome returned an invalid AlgoPIN.",
            })
        )
      );
      const pinId = yield* Schema.decodeUnknownEffect(IgloohomePinIdSchema)(
        response.pinId
      ).pipe(
        Effect.mapError(
          () =>
            new IgloohomeRequestError({
              operation: "issue_hourly_algopin",
              outcome: "ambiguous",
              message: "Igloohome returned an invalid PIN identifier.",
            })
        )
      );

      return { pin, pinId } satisfies IssuedHourlyAlgoPin;
    }
  );

  return { issueHourlyAlgoPin };
});

export class IgloohomeService extends Context.Service<
  IgloohomeService,
  Effect.Success<typeof makeIgloohomeService>
>()("IgloohomeService") {
  static Live = Layer.effect(this, makeIgloohomeService);

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(IgloohomeAccessToken.Live),
    Layer.provide(FetchHttpClient.layer)
  );
}
