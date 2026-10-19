// Renders the workspace location map from stub tiles into the JPEG file named
// by the first argument, so a test can render it in a process with a chosen
// font setup.
import "@/shared/testing/workspace-test-env";

import { mock } from "bun:test";
import sharp from "sharp";

mock.module("next/cache", () => ({ cacheLife: () => undefined }));

const tile = await sharp({
  create: { width: 256, height: 256, channels: 3, background: "#aad3df" },
})
  .png()
  .toBuffer();

globalThis.fetch = Object.assign(
  async () =>
    new Response(new Uint8Array(tile), {
      headers: { "Content-Type": "image/png" },
    }),
  { preconnect: globalThis.fetch.preconnect }
);

const [
  { runStandaloneWorkspaceEffect },
  { generateWorkspaceLocationMapImage },
] = await Promise.all([
  import("./standalone-workspace-effect"),
  import("./workspace-location-map"),
]);

await Bun.write(
  process.argv[2] ?? "",
  await generateWorkspaceLocationMapImage().pipe(
    runStandaloneWorkspaceEffect("workspaceLocationMap.renderFixture")
  )
);
