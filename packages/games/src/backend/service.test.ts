import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { GamesService } from "./service";

describe("GamesService", () => {
  test("loads and validates the documented games response", async () => {
    const requests: Request[] = [];
    const fetchMock = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        requests.push(request.clone());

        return Response.json({
          games: [
            {
              id: 3,
              bggId: 173346,
              name: "Darwin&#039;s &amp; &quot;Journey&quot; &#x1F3B2;",
              yearPublished: null,
              imageUrl: null,
              thumbnailUrl: null,
              description: null,
              minPlayers: null,
              maxPlayers: null,
              playingTimeMinutes: null,
              minAge: null,
              weight: null,
              rating: null,
              categories: null,
              mechanics: null,
              inStock: true,
              note: null,
              language: null,
              addedAt: "2026-08-30T11:45:06.698Z",
              updatedAt: "2026-08-30T11:45:06.698Z",
            },
          ],
        });
      }
    ) as unknown as typeof globalThis.fetch;
    const httpClientLayer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
    );

    const games = await Effect.gen(function* () {
      const service = yield* GamesService;
      return yield* service.listGames;
    }).pipe(
      Effect.provide(GamesService.Default.pipe(Layer.provide(httpClientLayer))),
      Effect.runPromise
    );

    expect(games).toHaveLength(1);
    expect(games[0]?.name).toBe('Darwin\'s & "Journey" 🎲');
    expect(games[0]?.yearPublished).toBeNull();
    expect(games[0]?.imageUrl).toBeNull();
    expect(games[0]?.thumbnailUrl).toBeNull();
    expect(games[0]?.minPlayers).toBeNull();
    expect(games[0]?.maxPlayers).toBeNull();
    expect(games[0]?.playingTimeMinutes).toBeNull();
    expect(games[0]?.categories).toBeNull();
    expect(requests.map((request) => request.url)).toEqual([
      "https://deskohub-games.vercel.app/api/games",
    ]);
  });
});
