import { expect, test } from "bun:test";
import { unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import nextConfig from "./next.config.mjs";

const resolveReferrerPolicy = async (path: string) =>
  (
    await unstable_getResponseFromNextConfig({
      url: `https://workspace.example${path}`,
      nextConfig,
    })
  ).headers.get("referrer-policy");

test("keeps the historical no-referrer default outside the localized landing pages", async () => {
  for (const path of [
    "/",
    "/en-US/reservation/cowork",
    "/cs-CZ/pricing",
    "/workspace-location-map.jpeg",
  ]) {
    expect(await resolveReferrerPolicy(path)).toBe("no-referrer");
  }
});

test("sends a tile-compatible referrer policy on the localized landing pages", async () => {
  for (const path of ["/en-US", "/cs-CZ"]) {
    expect(await resolveReferrerPolicy(path)).toBe(
      "strict-origin-when-cross-origin"
    );
  }
});
