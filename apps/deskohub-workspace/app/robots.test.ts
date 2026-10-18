import { describe, expect, mock, test } from "bun:test";
import { resolveRobots } from "next/dist/build/webpack/loaders/metadata/resolve-route-data";
import * as envModule from "@/env";

// The workspace env object is read once at import; route VERCEL_ENV through a
// switchable override so one file covers every deployment.
let vercelEnv = "production";
mock.module("@/env", () => ({
  ...envModule,
  env: new Proxy(envModule.env, {
    get: (target, key) =>
      key === "VERCEL_ENV" ? vercelEnv : Reflect.get(target, key),
  }),
}));

const { default: robots } = await import("./robots");

const robotsTxt = (deployment: string) => {
  vercelEnv = deployment;
  return resolveRobots(robots());
};

describe("robots.txt", () => {
  test("lets every crawler fetch production and points to the sitemap", () => {
    expect(robotsTxt("production")).toBe(
      [
        "User-Agent: *",
        "Allow: /",
        "",
        "Sitemap: https://workspace.deskohub.cz/sitemap.xml",
        "",
      ].join("\n")
    );
  });

  for (const deployment of ["preview", "development"]) {
    test(`blocks every crawler in ${deployment} and lists no sitemap`, () => {
      expect(robotsTxt(deployment)).toBe(
        ["User-Agent: *", "Disallow: /", "", ""].join("\n")
      );
    });
  }
});
