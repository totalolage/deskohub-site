import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { CustomerAgentAuthorizationError } from "./customer-agent-authorization.service";
import {
  type CustomerAgentClientAuthority,
  CustomerAgentClientDirectory,
} from "./customer-agent-client-directory.service";

const clientId = "https://assistant.invalid/oauth/client.json";

const find = (
  findPublicClient: CustomerAgentClientAuthority["findPublicClient"],
  id = clientId
) =>
  Effect.flatMap(CustomerAgentClientDirectory, (directory) =>
    directory.find(id)
  ).pipe(
    Effect.provide(
      CustomerAgentClientDirectory.fromAuthority({ findPublicClient })
    ),
    Effect.result,
    Effect.runPromise
  );

const providerRejection = (status?: number) =>
  Object.assign(new Error("Client not found"), {
    name: "APIError",
    ...(status !== undefined && { statusCode: status }),
  });

describe("CustomerAgentClientDirectory", () => {
  test("names the client and the host of its metadata URL", async () => {
    const requested: string[] = [];
    const result = await find(async (id) => {
      requested.push(id);
      return {
        client_id: id,
        client_name: "  Synthetic Assistant  ",
        client_uri: "https://home.invalid",
        logo_uri: "https://cdn.invalid/logo.png",
      };
    });

    expect(requested).toEqual([clientId]);
    expect(result).toMatchObject({
      _tag: "Success",
      success: Option.some({
        clientId,
        name: "Synthetic Assistant",
        host: "assistant.invalid",
      }),
    });
  });

  test("falls back to the client's home page host", async () => {
    const result = await find(
      async (id) => ({
        client_id: id,
        client_name: "Synthetic Assistant",
        client_uri: "https://home.invalid/about",
      }),
      "synthetic-client"
    );

    expect(result).toMatchObject({
      _tag: "Success",
      success: Option.some({
        clientId: "synthetic-client",
        name: "Synthetic Assistant",
        host: "home.invalid",
      }),
    });
  });

  test("leaves the host out when nothing names one", async () => {
    const result = await find(
      async (id) => ({ client_id: id, client_name: "Synthetic Assistant" }),
      "synthetic-client"
    );

    expect(result).toMatchObject({
      _tag: "Success",
      success: Option.some({
        clientId: "synthetic-client",
        name: "Synthetic Assistant",
      }),
    });
    if (result._tag === "Success" && Option.isSome(result.success)) {
      expect("host" in result.success.value).toBe(false);
    }
  });

  test.each([
    ["without a status", undefined],
    ["with a client error status", 404],
  ])(
    "finds nothing when the provider rejects the client %s",
    async (_label, status) => {
      const result = await find(async () => {
        throw providerRejection(status);
      });

      expect(result).toMatchObject({ _tag: "Success", success: Option.none() });
    }
  );

  test.each([
    ["a blank name", { client_name: "   " }],
    ["no name", {}],
  ])("finds nothing for a client with %s", async (_label, fields) => {
    const result = await find(async (id) => ({ client_id: id, ...fields }));

    expect(result).toMatchObject({ _tag: "Success", success: Option.none() });
  });

  test("finds nothing for an unreadable answer", async () => {
    const result = await find(async () => ({ client_name: "No ID" }));

    expect(result).toMatchObject({ _tag: "Success", success: Option.none() });
  });

  test("is unavailable when the read itself fails", async () => {
    const result = await find(async () => {
      throw new TypeError("fetch failed");
    });

    expect(result).toMatchObject({ _tag: "Failure" });
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(CustomerAgentAuthorizationError);
      expect(result.failure.reason).toBe("unavailable");
    }
  });
});
