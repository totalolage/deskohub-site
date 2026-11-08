import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import {
  publishRequest,
  resetMobileUpdatesSecrets,
  syntheticUpdate,
  uniqueRuntimeVersion,
  unsetMobileUpdatesSecret,
} from "@/features/mobile-updates/mobile-update-routes.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();
const { POST } = await import("./route");

describe.skipIf(!testDatabase)("mobile update publish route", () => {
  afterEach(resetMobileUpdatesSecrets);

  const android = () => ({
    platform: "android" as const,
    runtimeVersion: uniqueRuntimeVersion(),
  });

  test("publishes an update and answers 201", async () => {
    const response = await POST(publishRequest(syntheticUpdate(android())));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ status: "published" });
  });

  test("publishes a rollback to the embedded update", async () => {
    const response = await POST(
      publishRequest({
        type: "rollBackToEmbedded",
        id: crypto.randomUUID(),
        ...android(),
      })
    );

    expect(response.status).toBe(201);
  });

  test("answers a retried publication with 200 without publishing it again", async () => {
    const update = syntheticUpdate(android());
    await POST(publishRequest(update));

    const retried = await POST(publishRequest(update));

    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toEqual({
      status: "already-published",
    });
  });

  test("rejects a different publication under a published id with 409", async () => {
    const update = syntheticUpdate(android());
    await POST(publishRequest(update));

    const conflicting = await POST(
      publishRequest({ ...update, metadata: { branch: "other" } })
    );

    expect(conflicting.status).toBe(409);
  });

  test("rejects a publication for an unknown platform with 400", async () => {
    const response = await POST(
      publishRequest({ ...syntheticUpdate(android()), platform: "web" })
    );

    expect(response.status).toBe(400);
  });

  test.each([
    ["a hash that is no SHA-256", { hash: "not-a-digest" }],
    ["a plain-HTTP URL", { url: "http://blob.example/bundle.hbc" }],
    ["an extension without its dot", { fileExtension: "png" }],
  ])("rejects a launch asset with %s with 400", async (_, defect) => {
    const update = syntheticUpdate(android());
    if (update.type !== "update") throw new Error("Expected an update");

    const response = await POST(
      publishRequest({
        ...update,
        launchAsset: { ...update.launchAsset, ...defect },
      })
    );

    expect(response.status).toBe(400);
  });

  test.each([
    ["no", null],
    ["a wrong", "Bearer wrong-token"],
  ])(
    "rejects a request with %s publish token with 401",
    async (_, authorization) => {
      const response = await POST(
        publishRequest(syntheticUpdate(android()), authorization)
      );

      expect(response.status).toBe(401);
    }
  );

  test("answers 503 while the deployment has no publish token", async () => {
    unsetMobileUpdatesSecret("MOBILE_UPDATES_PUBLISH_TOKEN");

    const response = await POST(
      publishRequest(syntheticUpdate(android()), "Bearer undefined")
    );

    expect(response.status).toBe(503);
  });
});
