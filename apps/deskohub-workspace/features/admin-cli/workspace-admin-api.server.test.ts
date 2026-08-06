import { describe, expect, test } from "bun:test";
import { WorkspaceAdminApi } from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import { AdminCliApiHandlers } from "./workspace-admin-api.server";

describe("Workspace Admin API", () => {
  test("serves the shared CLI info contract", async () => {
    const info = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, ["cli"]);
      return yield* client.cli.getInfo({});
    }).pipe(
      Effect.provide(AdminCliApiHandlers),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(info).toEqual({
      apiVersion: "v1",
      service: "deskohub-workspace",
    });
  });
});
