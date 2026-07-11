import { describe, expect, test } from "bun:test";
import { findDeploymentUrl } from "./production-build";

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

  test("returns undefined when the output has no deployment URL", () => {
    expect(findDeploymentUrl("Deployment failed")).toBeUndefined();
  });
});
