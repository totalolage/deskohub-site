import { afterEach, describe, expect, test } from "bun:test";
import { siteConstants } from "@/shared/utils/constants";
import { resolvePublicDomain } from "./public-domain";

const noSources = {
  vercelUrl: undefined,
  productionUrl: undefined,
  nodeEnv: "production",
  port: undefined,
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("resolvePublicDomain", () => {
  test("uses the browser's origin in the browser", () => {
    Object.assign(globalThis, {
      window: { location: { origin: "https://browser.example.test" } },
    });

    expect(
      resolvePublicDomain({
        ...noSources,
        vercelUrl: "https://deployment.example.test",
      })
    ).toBe("https://browser.example.test");
  });

  test("prefers the deployment URL over the production URL", () => {
    expect(
      resolvePublicDomain({
        ...noSources,
        vercelUrl: "https://deployment.example.test",
        productionUrl: "https://production.example.test",
      })
    ).toBe("https://deployment.example.test");
  });

  test("uses the production URL without a deployment URL", () => {
    expect(
      resolvePublicDomain({
        ...noSources,
        productionUrl: "https://production.example.test",
      })
    ).toBe("https://production.example.test");
  });

  test("uses the local dev server in development", () => {
    expect(
      resolvePublicDomain({
        ...noSources,
        nodeEnv: "development",
        port: "4100",
      })
    ).toBe("http://localhost:4100");
    expect(resolvePublicDomain({ ...noSources, nodeEnv: "development" })).toBe(
      "http://localhost:3000"
    );
  });

  test("falls back to the public brand domain", () => {
    expect(resolvePublicDomain(noSources)).toBe(
      `https://${siteConstants.brand.publicDomain}`
    );
  });
});
