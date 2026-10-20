import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import sharp from "sharp";
import { runCommand } from "@/scripts/shared/command";
import {
  generateWorkspaceLocationMapImage,
  workspaceLocationMapTileConcurrency,
} from "./workspace-location-map";

const renderWithFetch = (
  handler: (init: RequestInit | undefined) => Promise<Response>
) =>
  generateWorkspaceLocationMapImage().pipe(
    Effect.provideService(
      FetchHttpClient.Fetch,
      Object.assign(
        (_input: RequestInfo | URL, init?: RequestInit) => handler(init),
        { preconnect: globalThis.fetch.preconnect }
      )
    )
  );

describe("generateWorkspaceLocationMapImage", () => {
  test("limits concurrent OpenStreetMap tile requests and fails on a failed tile", async () => {
    let inFlight = 0;
    let maximumInFlight = 0;
    const failedRender = renderWithFetch(async () => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return new Response(null, { status: 503 });
    });

    const error = await Effect.runPromise(Effect.flip(failedRender));

    expect(error).toMatchObject({
      _tag: "OsmTileRequestError",
      statusCode: 503,
    });
    expect(maximumInFlight).toBeGreaterThan(0);
    expect(maximumInFlight).toBeLessThanOrEqual(
      workspaceLocationMapTileConcurrency
    );
  });

  test("asks Next's shared fetch cache to keep each tile for at least a week", async () => {
    const requests: (RequestInit | undefined)[] = [];
    await Effect.runPromise(
      Effect.flip(
        renderWithFetch(async (init) => {
          requests.push(init);
          return new Response(null, { status: 503 });
        })
      )
    );

    expect(requests.length).toBeGreaterThan(0);
    for (const init of requests) {
      expect(init?.cache).toBe("force-cache");
      expect(init?.next?.revalidate).toBeGreaterThanOrEqual(7 * 24 * 60 * 60);
    }
  });
});

// Vercel functions have no system fonts, and text that falls back on them
// renders as empty boxes.
describe("workspace location map attribution", () => {
  const renderWithFonts = async (
    directory: string,
    fontDirectories: readonly string[]
  ) => {
    const renderDirectory = await mkdtemp(join(directory, "render-"));
    const configFile = join(renderDirectory, "fonts.conf");
    const imageFile = join(renderDirectory, "map.jpeg");
    await writeFile(
      configFile,
      `<?xml version="1.0"?>
<fontconfig>
${fontDirectories.map((fontDirectory) => `<dir>${fontDirectory}</dir>`).join("\n")}
<cachedir>${join(renderDirectory, "cache")}</cachedir>
</fontconfig>
`
    );
    const { exitCode, stderr } = await runCommand(
      [
        process.execPath,
        join(import.meta.dir, "workspace-location-map.render-fixture.ts"),
        imageFile,
      ],
      {
        env: { ...process.env, FONTCONFIG_FILE: configFile },
        timeoutMs: 60_000,
      }
    );
    expect({ exitCode, errors: exitCode === 0 ? "" : stderr }).toEqual({
      exitCode: 0,
      errors: "",
    });
    return readFile(imageFile);
  };

  test("draws the OpenStreetMap attribution without system fonts", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "workspace-location-map-fonts-")
    );
    try {
      const [withoutFonts, withBundledFontOnly] = await Promise.all([
        renderWithFonts(directory, []),
        renderWithFonts(directory, [
          join(process.cwd(), "assets", "fonts", "Geist"),
        ]),
      ]);

      // Without its own font the attribution would be drawn with whatever
      // fonts the system has, or as empty boxes when it has none.
      expect(withoutFonts.equals(withBundledFontOnly)).toBe(true);

      const { data, info } = await sharp(withoutFonts)
        .extract({ left: 2000, top: 1220, width: 400, height: 60 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let textPixels = 0;
      for (let offset = 0; offset < data.length; offset += info.channels) {
        textPixels +=
          (data[offset] ?? 255) < 96 && (data[offset + 2] ?? 0) > 32 ? 1 : 0;
      }
      expect(textPixels).toBeGreaterThan(200);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
