import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import {
  generateWorkspaceLocationMapImage,
  workspaceLocationMapTileConcurrency,
} from "./workspace-location-map";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("generateWorkspaceLocationMapImage", () => {
  test("limits concurrent OpenStreetMap tile requests", async () => {
    let inFlight = 0;
    let maximumInFlight = 0;
    globalThis.fetch = Object.assign(
      async () => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return new Response(null, { status: 503 });
      },
      { preconnect: originalFetch.preconnect }
    );

    const exit = await Effect.runPromiseExit(
      generateWorkspaceLocationMapImage()
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(maximumInFlight).toBeGreaterThan(0);
    expect(maximumInFlight).toBeLessThanOrEqual(
      workspaceLocationMapTileConcurrency
    );
  });
});
