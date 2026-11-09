import { describe, expect, test } from "bun:test";
import {
  findDeploymentUrl,
  skippedSourceMapUploadWarnings,
} from "./production-build";

describe("findDeploymentUrl", () => {
  test("returns the final Vercel deployment URL", () => {
    expect(
      findDeploymentUrl(`
Inspect: https://vercel.com/example/deployment
Production: https://workspace-old.vercel.app
Aliased: https://workspace-new.vercel.app
`)
    ).toBe("https://workspace-new.vercel.app");
  });
});

describe("skippedSourceMapUploadWarnings", () => {
  test("annotates the release run once per skipped upload", () => {
    expect(
      skippedSourceMapUploadWarnings(`
18:48:43.956 deskohub-workspace:build:source-maps: $ bun scripts/upload-source-maps.ts
18:48:50.101 deskohub-workspace:build:source-maps: PostHog source-map upload attempt failed (transient): posthog-cli exited with code 1: HTTP 503.
18:49:20.512 deskohub-workspace:build:source-maps: PostHog source-map upload skipped: posthog-cli exited with code 1: HTTP 503. Deleted 2 public source maps; 100% unsymbolicated\r
`)
    ).toEqual([
      "::warning title=Source maps not uploaded to PostHog::posthog-cli exited with code 1: HTTP 503. Deleted 2 public source maps; 100%25 unsymbolicated\n",
    ]);
  });

  test("stays quiet when the upload succeeded", () => {
    expect(
      skippedSourceMapUploadWarnings(
        "deskohub-workspace:build:source-maps: $ bun scripts/upload-source-maps.ts\n"
      )
    ).toEqual([]);
  });
});
