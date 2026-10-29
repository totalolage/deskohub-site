import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import type {
  DownscaleCase,
  DownscaleReport,
} from "./image-downscaling.browser-harness";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let harness = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  const build = await Bun.build({
    // Next.js provides `process.env` to browser code; this bundle has no Next.js.
    define: { "process.env": JSON.stringify({ NODE_ENV: "production" }) },
    entrypoints: [
      join(import.meta.dir, "image-downscaling.browser-harness.ts"),
    ],
    format: "iife",
    target: "browser",
  });
  const [output] = build.outputs;
  if (!build.success || !output) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  harness = await output.text();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const emailLimits = {
  maxWidth: 1068,
  maxPixels: 25_000_000,
  maxBytes: 10 * 1024 * 1024,
};

const downscale = async (
  input: Partial<DownscaleCase>
): Promise<DownscaleReport> => {
  if (!browser) throw new Error("The browser has not been launched.");
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: harness });
    if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
    return await page.evaluate((spec) => window.downscale(spec), {
      width: 3000,
      height: 2000,
      type: "image/png",
      transparent: false,
      sideways: false,
      undecodable: false,
      limits: emailLimits,
      ...input,
    } satisfies DownscaleCase);
  } finally {
    await page.close();
  }
};

test.skipIf(!chromiumAvailable)(
  "narrows an opaque picture and encodes it as a JPEG",
  async () => {
    expect(await downscale({})).toMatchObject({
      outcome: "downscaled",
      type: "image/jpeg",
      width: 1068,
      height: 712,
      transparent: false,
    });
  },
  30_000
);

test.skipIf(!chromiumAvailable)(
  "keeps a transparent picture's alpha in a PNG",
  async () => {
    expect(await downscale({ transparent: true })).toMatchObject({
      outcome: "downscaled",
      type: "image/png",
      width: 1068,
      transparent: true,
    });
  },
  30_000
);

test.skipIf(!chromiumAvailable)(
  "turns a picture upright as its EXIF orientation says",
  async () => {
    expect(
      await downscale({
        width: 1200,
        height: 800,
        type: "image/jpeg",
        sideways: true,
        limits: { ...emailLimits, maxWidth: 2000 },
      })
    ).toMatchObject({ outcome: "downscaled", width: 800, height: 1200 });
  },
  30_000
);

test.skipIf(!chromiumAvailable)(
  "shrinks further until the file fits the byte limit",
  async () => {
    const report = await downscale({
      limits: { ...emailLimits, maxBytes: 200_000 },
    });

    expect(report.outcome === "downscaled" && report.bytes).toBeLessThanOrEqual(
      200_000
    );
  },
  30_000
);

test.skipIf(!chromiumAvailable)(
  "fails a file no browser can decode",
  async () => {
    expect(await downscale({ undecodable: true })).toEqual({
      outcome: "ImageDecodeError",
    });
  },
  30_000
);
