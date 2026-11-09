import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { env } from "@/env";
import {
  getMarketingPreferencesAccessUrl,
  getRuntimeMarketingPreferencesAccessUrl,
  getRuntimeMarketingPreferencesPlaceholderUrl,
} from "./marketing-preferences-access-url";

const syntheticBypassSecret = "synthetic-preferences-bypass-secret";

/** Runs `run` on a preview deployment that has an automation bypass secret. */
const withPreviewBypassSecret = async <A>(run: () => Promise<A>) => {
  const previous = {
    VERCEL_ENV: env.VERCEL_ENV,
    VERCEL_AUTOMATION_BYPASS_SECRET: env.VERCEL_AUTOMATION_BYPASS_SECRET,
  };
  Object.assign(env, {
    VERCEL_ENV: "preview",
    VERCEL_AUTOMATION_BYPASS_SECRET: syntheticBypassSecret,
  });
  try {
    return await run();
  } finally {
    Object.assign(env, previous);
  }
};

describe("getMarketingPreferencesAccessUrl", () => {
  test("links the access route without a locale, carrying the token", () => {
    const url = new URL(
      getMarketingPreferencesAccessUrl(
        "a+b/c",
        new URL("https://workspace.deskohub.cz")
      )
    );

    expect(url.origin).toBe("https://workspace.deskohub.cz");
    expect(url.pathname).toBe("/marketing-preferences/access");
    expect(url.searchParams.getAll("token")).toEqual(["a+b/c"]);
  });

  test("uses the running deployment's origin", async () => {
    const url = new URL(
      await Effect.runPromise(getRuntimeMarketingPreferencesAccessUrl("token"))
    );

    expect(url.origin).toBe("http://deskohub.test");
    expect(url.pathname).toBe("/marketing-preferences/access");
  });

  test("lets a recipient through preview protection", async () => {
    const url = new URL(
      await withPreviewBypassSecret(() =>
        Effect.runPromise(getRuntimeMarketingPreferencesAccessUrl("token"))
      )
    );

    expect(url.searchParams.get("x-vercel-protection-bypass")).toBe(
      syntheticBypassSecret
    );
    expect(url.searchParams.get("x-vercel-set-bypass-cookie")).toBe("true");
  });
});

describe("getRuntimeMarketingPreferencesPlaceholderUrl", () => {
  test("links the access route on the running deployment's origin", async () => {
    const url = new URL(
      await Effect.runPromise(getRuntimeMarketingPreferencesPlaceholderUrl)
    );

    expect(url.origin).toBe("http://deskohub.test");
    expect(url.pathname).toBe("/marketing-preferences/access");
    expect(url.searchParams.get("token")).toBe("preview");
  });

  test("carries no preview protection bypass", async () => {
    const url = await withPreviewBypassSecret(() =>
      Effect.runPromise(getRuntimeMarketingPreferencesPlaceholderUrl)
    );

    expect(url).not.toContain(syntheticBypassSecret);
    expect([...new URL(url).searchParams.keys()]).toEqual(["token"]);
  });
});
