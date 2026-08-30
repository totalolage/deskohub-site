import { Context, Effect, Layer } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { GamesRequestError } from "../errors";
import { type Game, make } from "../generated/effect.gen";

const GAMES_API_ORIGIN = "https://deskohub-games.vercel.app";

interface IGamesService {
  readonly listGames: Effect.Effect<ReadonlyArray<Game>, GamesRequestError>;
}

export class GamesService extends Context.Service<
  GamesService,
  IGamesService
>()("@deskohub/games/GamesService") {
  static Default = Layer.effect(this, makeGamesService());

  static Live = this.Default.pipe(Layer.provide(FetchHttpClient.layer));
}

function makeGamesService() {
  return Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const client = make(httpClient, {
      transformClient: (generatedClient) =>
        Effect.succeed(
          generatedClient.pipe(
            HttpClient.mapRequestInput((request) =>
              request.pipe(HttpClientRequest.prependUrl(GAMES_API_ORIGIN))
            )
          )
        ),
    });

    const listGames = Effect.fn("GamesService.listGames")(function* () {
      const response = yield* client.listGames(undefined).pipe(
        Effect.mapError(
          (cause) =>
            new GamesRequestError({
              message: "The board-game catalog request failed.",
              cause,
            })
        )
      );

      return response.games.map((game) => ({
        ...game,
        name: game.name.replaceAll("&#039;", "'"),
      }));
    });

    return { listGames: listGames() };
  });
}
