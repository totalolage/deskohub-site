import { Context, Effect, Layer, Schedule } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { decodeHTML } from "entities";
import { GamesRequestError } from "../errors";
import { type Game, make } from "../generated/effect.gen";

const GAMES_API_ORIGIN = "https://deskohub-games.vercel.app";
const catalogRequestTimeout = "10 seconds";
const catalogRetryTimes = 2;

const makeGamesService = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const client = make(httpClient, {
    transformClient: (generatedClient) =>
      Effect.succeed(
        generatedClient.pipe(
          HttpClient.mapRequestInput((request) =>
            request.pipe(HttpClientRequest.prependUrl(GAMES_API_ORIGIN))
          ),
          HttpClient.retryTransient({
            schedule: Schedule.exponential("200 millis"),
            times: catalogRetryTimes,
          })
        )
      ),
  });

  const listGames = Effect.fn("GamesService.listGames")(function* () {
    const response = yield* client["GET/api/games"](undefined).pipe(
      Effect.mapError(
        (cause) =>
          new GamesRequestError({
            message: "The board-game catalog request failed.",
            cause,
          })
      ),
      Effect.timeoutOrElse({
        duration: catalogRequestTimeout,
        orElse: () =>
          Effect.fail(
            new GamesRequestError({
              message: "The board-game catalog request timed out.",
            })
          ),
      })
    );

    return response.games.map((game) => ({
      ...game,
      name: decodeHTML(game.name),
    }));
  });

  return { listGames: listGames() };
});

interface IGamesService {
  readonly listGames: Effect.Effect<ReadonlyArray<Game>, GamesRequestError>;
}

export class GamesService extends Context.Service<
  GamesService,
  IGamesService
>()("@deskohub/games/GamesService") {
  static Default = Layer.effect(this, makeGamesService);

  static Live = this.Default.pipe(Layer.provide(FetchHttpClient.layer));
}
