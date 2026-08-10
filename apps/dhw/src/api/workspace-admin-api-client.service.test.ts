import { describe, expect, test } from "bun:test";
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { DhwConfig } from "../config/dhw-config.service";
import { WorkspaceAdminApiClient } from "./workspace-admin-api-client.service";

describe("WorkspaceAdminApiClient", () => {
  test("uses the shared contract and configured preview headers", async () => {
    const previewHeaders: Array<string | null> = [];
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        previewHeaders.push(request.headers.get("x-preview-bypass"));
        return Response.json({
          apiVersion: "v1",
          service: "deskohub-workspace",
        });
      },
    });

    try {
      const config = Layer.succeed(DhwConfig, {
        baseUrl: new URL(`http://127.0.0.1:${server.port}`),
        requestHeaders: {
          "x-preview-bypass": Redacted.make("preview-secret"),
        },
        isCi: true,
        stateDirectory: "/tmp/dhw-client-test",
        updateChecksDisabled: true,
      });
      const clientLayer = WorkspaceAdminApiClient.Live.pipe(
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(config)
      );
      const info = await Effect.gen(function* () {
        const client = yield* WorkspaceAdminApiClient;
        return yield* client.getInfo;
      }).pipe(Effect.provide(clientLayer), Effect.runPromise);

      expect(info).toEqual({
        apiVersion: "v1",
        service: "deskohub-workspace",
      });
      expect(previewHeaders).toEqual(["preview-secret"]);
    } finally {
      server.stop(true);
    }
  });
});
