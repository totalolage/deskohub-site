import { afterEach, expect, test } from "bun:test";
import {
  getRewrittenUrl,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import nextConfig from "./next.config.mjs";

const resolveHeaders = async (path: string) =>
  (
    await unstable_getResponseFromNextConfig({
      url: `https://workspace.example${path}`,
      nextConfig,
    })
  ).headers;

const resolveReferrerPolicy = async (path: string) =>
  (await resolveHeaders(path)).get("referrer-policy");

const originTrialTokensBefore = process.env.WEBMCP_ORIGIN_TRIAL_TOKENS;

afterEach(() => {
  if (originTrialTokensBefore === undefined) {
    delete process.env.WEBMCP_ORIGIN_TRIAL_TOKENS;
  } else {
    process.env.WEBMCP_ORIGIN_TRIAL_TOKENS = originTrialTokensBefore;
  }
});

test("sends no referrer from every page, including the localized landing pages", async () => {
  for (const path of [
    "/",
    "/en-US",
    "/cs-CZ",
    "/en-US/reservation/cowork",
    "/cs-CZ/pricing",
    "/workspace-location-map.jpeg",
  ]) {
    expect(await resolveReferrerPolicy(path)).toBe("no-referrer");
  }
});

test("enrolls pages in the WebMCP origin trial with every configured token", async () => {
  process.env.WEBMCP_ORIGIN_TRIAL_TOKENS = " chrome-token , edge-token ,";

  for (const path of ["/", "/en-US", "/cs-CZ/reservation/cowork"]) {
    expect((await resolveHeaders(path)).get("origin-trial")).toBe(
      "chrome-token, edge-token"
    );
  }
  for (const path of ["/api/mcp", "/_next/static/chunks/main.js"]) {
    const headers = await resolveHeaders(path);
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.has("origin-trial")).toBe(false);
  }
});

test("sends no Origin-Trial header without configured tokens", async () => {
  for (const tokens of [undefined, "", " , "]) {
    if (tokens === undefined) {
      delete process.env.WEBMCP_ORIGIN_TRIAL_TOKENS;
    } else {
      process.env.WEBMCP_ORIGIN_TRIAL_TOKENS = tokens;
    }

    expect((await resolveHeaders("/en-US")).has("origin-trial")).toBe(false);
  }
});

const resolveRewrite = async (path: string) =>
  getRewrittenUrl(
    await unstable_getResponseFromNextConfig({
      url: `https://workspace.example${path}`,
      nextConfig,
    })
  );

test("sends an unmatched dotted path outside the locales to the locale redirect", async () => {
  for (const path of [
    "/nope.html",
    "/a/b.php",
    "/.well-known/unknown.json",
    "/en/nope.html",
    "/en-US.html",
    "/cs-CZ.example/a.php",
    "/de-de/x.html",
    "/xx-YY/a.txt",
  ]) {
    expect(await resolveRewrite(path)).toBe(
      `https://workspace.example/locale-redirect${path}`
    );
  }
});

test("leaves locale, API, build asset and undotted paths to their routes", async () => {
  for (const path of [
    "/cs-CZ/nope.html",
    "/en-US/a/b.php",
    "/en-US.rsc",
    "/cs-CZ.prefetch.rsc",
    "/en-US.segments/_tree.segment.rsc",
    "/api/v1/cli/file.json",
    "/_next/static/chunks/main.js",
    "/_vercel/insights/script.js",
    "/page-markdown/cs-CZ/faq.md",
    "/workspace-location-map/wide.webp",
    "/nope",
  ]) {
    expect(await resolveRewrite(path)).toBeNull();
  }
});
