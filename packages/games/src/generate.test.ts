import { expect, test } from "bun:test";
import { Schema } from "effect";

test("generates the Effect client from the OpenAPI contract", async () => {
  const packageDirectory = new URL("..", import.meta.url);
  const generation = Bun.spawn(["bun", "run", "generate"], {
    cwd: packageDirectory.pathname,
    stderr: "pipe",
  });

  const [exitCode, stderr] = await Promise.all([
    generation.exited,
    new Response(generation.stderr).text(),
  ]);

  if (exitCode !== 0) throw new Error(stderr);
  expect(exitCode).toBe(0);
  const generatedPath = new URL(
    "src/generated/effect.gen.ts",
    packageDirectory
  );
  const generatedSource = await Bun.file(generatedPath).text();
  const generated = await import(generatedPath.href);
  const decodeGame = Schema.decodeUnknownSync(generated.Game);
  const decodeParams = Schema.decodeUnknownSync(generated.ApiGamesParams);
  const requiredGame = {
    id: 1,
    bggId: 13,
    name: "Catan",
    inStock: true,
    addedAt: "2026-08-20T14:32:00.000Z",
    updatedAt: "2026-08-28T09:10:00.000Z",
  };

  expect(
    decodeGame({
      ...requiredGame,
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
      note: null,
      language: null,
    })
  ).toMatchObject(requiredGame);
  expect(decodeGame(requiredGame)).toEqual(requiredGame);
  expect(
    decodeGame({ ...requiredGame, weight: 2.31, rating: 7.4, language: "cz" })
  ).toMatchObject({ weight: 2.31, rating: 7.4, language: "cz" });
  expect(() => decodeGame({ ...requiredGame, language: "de" })).toThrow();
  expect(decodeParams({})).toEqual({});
  expect(decodeParams({ all: "1" })).toEqual({ all: "1" });
  expect(() => decodeParams({ all: "2" })).toThrow();
  expect(generatedSource).toContain('readonly "GET/api/games"');
  expect(generatedSource).toContain(
    'HttpClientRequest.setUrlParams({ "all": options?.params?.["all"] as any })'
  );
  expect(generatedSource).toContain(
    'description: "Error response did not match the documented schema"'
  );
});
