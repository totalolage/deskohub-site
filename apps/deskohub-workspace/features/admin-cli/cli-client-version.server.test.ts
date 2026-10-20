import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  CliClientCompatibility,
  CliInputInvalid,
  DhwVersion,
  dhwVersionHeader,
  MinimumDhwVersion,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import {
  CliClientCompatibilityLive,
  collectMinimumDhwVersions,
  minimumDhwVersions,
} from "./cli-client-version";
import { handleWorkspaceAdminApiRequest } from "./workspace-admin-api.server";

const minimum = DhwVersion.make("1.20.0");

// A test-local API exercises header edge cases through the same middleware.
const TestApi = HttpApi.make("testApi")
  .add(
    HttpApiGroup.make("campaigns")
      .add(
        HttpApiEndpoint.get("listCampaigns", "/campaigns", {
          success: Schema.String,
        }).annotate(MinimumDhwVersion, Option.some(minimum))
      )
      .add(
        HttpApiEndpoint.post("createCampaign", "/campaigns", {
          success: Schema.String,
        })
      )
      .add(
        HttpApiEndpoint.get("listTemplates", "/templates", {
          success: Schema.String,
        }).annotate(MinimumDhwVersion, Option.none())
      )
      // An endpoint's own annotation overrides its group's.
      .annotate(MinimumDhwVersion, Option.some(minimum))
  )
  .add(
    HttpApiGroup.make("administration").add(
      HttpApiEndpoint.get("listReservations", "/reservations", {
        success: Schema.String,
      })
    )
  )
  .middleware(CliClientCompatibility);

const handleTestRequest = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(TestApi).pipe(
    Layer.provide(
      Layer.mergeAll(
        HttpApiBuilder.group(TestApi, "campaigns", (handlers) =>
          handlers
            .handle("listCampaigns", () => Effect.succeed("listed"))
            .handle("createCampaign", () => Effect.succeed("created"))
            .handle("listTemplates", () => Effect.succeed("listed"))
        ),
        HttpApiBuilder.group(TestApi, "administration", (handlers) =>
          handlers.handle("listReservations", () => Effect.succeed("listed"))
        )
      )
    ),
    // Each group captures the middleware when it's built.
    Layer.provide(CliClientCompatibilityLive),
    Layer.provide(NodeHttpServer.layerHttpServices)
  ),
  { disableLogger: true }
).handler;

const request = (
  method: "GET" | "POST",
  path: string,
  version: string | undefined
) =>
  handleTestRequest(
    new Request(`https://workspace.deskohub.test${path}`, {
      method,
      headers: version === undefined ? {} : { [dhwVersionHeader]: version },
    })
  );

const operations = [
  ["GET", "/campaigns"],
  ["POST", "/campaigns"],
] as const;

describe("dhw client version", () => {
  test.each([
    ["no header", undefined],
    ["an older version", "1.19.9"],
    ["a prerelease of the minimum", "1.20.0-rc.1"],
    ["a malformed version", "v1.20"],
  ])(
    "rejects %s on a campaign read and write with a minimum",
    async (_, version) => {
      for (const [method, path] of operations) {
        const response = await request(method, path, version);

        expect(response.status).toBe(400);
        expect(
          Schema.decodeUnknownSync(CliInputInvalid)(await response.json())
        ).toMatchObject({
          message:
            "This dhw version is too old for email campaigns. Run `dhw update`.",
        });
      }
    }
  );

  test.each([
    ["the minimum", "1.20.0"],
    ["a newer version", "1.21.0"],
    ["a pull-request build of the minimum", "1.20.0+pr.743.abc1234"],
  ])("accepts %s on a campaign read and write", async (_, version) => {
    for (const [method, path] of operations) {
      const response = await request(method, path, version);

      expect(response.status).toBe(200);
    }
  });

  test.each([
    ["no header", undefined],
    ["an older version", "1.0.0"],
    ["a malformed version", "development"],
  ])("lets %s call an operation without a minimum", async (_, version) => {
    for (const path of ["/reservations", "/templates"]) {
      const response = await request("GET", path, version);

      expect(response.status).toBe(200);
      expect(await response.json()).toBe("listed");
    }
  });

  test("checks the version on every campaign operation and wherever a minimum is set", () => {
    const unchecked: string[] = [];
    HttpApi.reflect(WorkspaceAdminApi, {
      onGroup: () => undefined,
      onEndpoint: ({ group, endpoint, mergedAnnotations, middleware }) => {
        const mustCheck =
          group.identifier === "campaigns" ||
          Option.isSome(Context.get(mergedAnnotations, MinimumDhwVersion));
        if (mustCheck && !middleware.has(CliClientCompatibility)) {
          unchecked.push(`${group.identifier}.${endpoint.name}`);
        }
      },
    });

    expect(unchecked).toEqual([]);
  });

  test("lists each operation's minimum by group and endpoint", () => {
    expect(collectMinimumDhwVersions(TestApi)).toEqual({
      "campaigns.listCampaigns": minimum,
      "campaigns.createCampaign": minimum,
    });
  });

  test("reports the campaigns minimum and no minimum for other groups", async () => {
    const expectedMinimums: Record<string, DhwVersion> = {};
    HttpApi.reflect(WorkspaceAdminApi, {
      onGroup: () => undefined,
      onEndpoint: ({ group, endpoint, mergedAnnotations }) => {
        const endpointMinimum = Context.get(
          mergedAnnotations,
          MinimumDhwVersion
        );
        if (group.identifier === "campaigns") {
          expect(endpointMinimum).toEqual(Option.some(minimum));
          expectedMinimums[`campaigns.${endpoint.name}`] = minimum;
        } else {
          expect(endpointMinimum).toEqual(Option.none());
        }
      },
    });

    const response = await handleWorkspaceAdminApiRequest(
      new Request("https://workspace.deskohub.test/api/v1/cli/info", {
        headers: { [dhwVersionHeader]: "not-a-version" },
      })
    );

    expect(minimumDhwVersions).toEqual(expectedMinimums);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      apiVersion: "v1",
      service: "deskohub-workspace",
      minimumDhwVersions: expectedMinimums,
    });
  });
});
