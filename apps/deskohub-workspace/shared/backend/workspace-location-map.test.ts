import "@/shared/testing/workspace-test-env";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import sharp from "sharp";

const cacheLife = mock((_profile: { readonly expire: number }) => undefined);

mock.module("next/cache", () => ({ cacheLife }));

const {
  generateWorkspaceLocationMapImage,
  workspaceLocationMapTileConcurrency,
} = await import("./workspace-location-map");

const originalFetch = globalThis.fetch;

const mockFetch = (
  handler: (init: RequestInit | undefined) => Promise<Response>
) => {
  globalThis.fetch = Object.assign(
    (_input: RequestInfo | URL, init?: RequestInit) => handler(init),
    { preconnect: originalFetch.preconnect }
  );
};

beforeEach(() => {
  cacheLife.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe("generateWorkspaceLocationMapImage", () => {
  test("limits concurrent OpenStreetMap tile requests and fails on a failed tile", async () => {
    let inFlight = 0;
    let maximumInFlight = 0;
    mockFetch(async () => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return new Response(null, { status: 503 });
    });

    const error = await Effect.runPromise(
      Effect.flip(generateWorkspaceLocationMapImage())
    );

    expect(error).toMatchObject({
      _tag: "OsmTileRequestError",
      statusCode: 503,
    });
    expect(maximumInFlight).toBeGreaterThan(0);
    expect(maximumInFlight).toBeLessThanOrEqual(
      workspaceLocationMapTileConcurrency
    );
    // A failed download is not kept for later renders.
    expect(cacheLife).toHaveBeenCalled();
    expect(new Set(cacheLife.mock.calls.map(([life]) => life.expire))).toEqual(
      new Set([0])
    );
  });

  test("aborts tile downloads that outlast the tile timeout", async () => {
    jest.useFakeTimers();
    const signals: (AbortSignal | null | undefined)[] = [];
    mockFetch(
      (init) =>
        new Promise((_resolve, reject) => {
          signals.push(init?.signal);
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        })
    );

    const render = Effect.runPromiseExit(generateWorkspaceLocationMapImage());
    for (let step = 0; step < 100 && signals.length === 0; step += 1) {
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    }
    jest.advanceTimersByTime(10_000);
    await render;

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
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
    const render = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "workspace-location-map.render-fixture.ts"),
        imageFile,
      ],
      {
        env: { ...process.env, FONTCONFIG_FILE: configFile },
        stderr: "pipe",
        stdin: "ignore",
        stdout: "ignore",
      }
    );
    const [errors, exitCode] = await Promise.all([
      new Response(render.stderr).text(),
      render.exited,
    ]);
    expect({ exitCode, errors: exitCode === 0 ? "" : errors }).toEqual({
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
