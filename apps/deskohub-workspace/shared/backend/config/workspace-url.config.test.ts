import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { Effect } from "effect";
import { getWorkspaceCallbackOrigin } from "./workspace-url.config";

const getOrigin = (environment: {
  readonly deploymentEnvironment: "development" | "preview" | "production";
  readonly deploymentUrl: string;
  readonly productionUrl?: string;
}) => Effect.runSync(getWorkspaceCallbackOrigin(environment)).origin;

test("selects the callback origin from the runtime environment", () => {
  expect(
    getOrigin({
      deploymentEnvironment: "preview",
      deploymentUrl: "preview-a.vercel.app",
    })
  ).toBe("https://preview-a.vercel.app");

  expect(
    getOrigin({
      deploymentEnvironment: "preview",
      deploymentUrl: "preview-b.vercel.app",
    })
  ).toBe("https://preview-b.vercel.app");

  expect(
    getOrigin({
      deploymentEnvironment: "development",
      deploymentUrl: "localhost:3000",
    })
  ).toBe("http://localhost:3000");

  expect(
    getOrigin({
      deploymentEnvironment: "production",
      deploymentUrl: "ignored.vercel.app",
      productionUrl: "workspace.deskohub.cz",
    })
  ).toBe("https://workspace.deskohub.cz");
});
