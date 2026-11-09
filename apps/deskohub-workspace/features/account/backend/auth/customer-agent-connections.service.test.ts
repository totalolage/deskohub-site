import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { CustomerAgentClientAuthority } from "./customer-agent-client-directory.service";
import { CustomerAgentClientDirectory } from "./customer-agent-client-directory.service";
import {
  CustomerAgentConnections,
  type CustomerAgentConsentAuthority,
} from "./customer-agent-connections.service";

const assistantId = "https://assistant.invalid/oauth/client.json";
const helperId = "https://helper.invalid/oauth/client.json";

const consent = (
  id: string,
  clientId: string,
  createdAt: string | Date,
  scopes: readonly string[] = ["reservations:read"]
) => ({
  id,
  clientId,
  userId: "synthetic-user",
  scopes,
  createdAt,
  updatedAt: createdAt,
});

const publicClients = new Map([
  [assistantId, { client_id: assistantId, client_name: "Synthetic Assistant" }],
  [helperId, { client_id: helperId, client_name: "Synthetic Helper" }],
]);

const providerRejection = () =>
  Object.assign(new Error("Client not found"), {
    name: "APIError",
    statusCode: 404,
  });

const list = (
  listConsents: CustomerAgentConsentAuthority["listConsents"],
  findPublicClient: CustomerAgentClientAuthority["findPublicClient"] = async (
    clientId
  ) => {
    const client = publicClients.get(clientId);
    if (client === undefined) throw providerRejection();
    return client;
  }
) =>
  Effect.flatMap(
    CustomerAgentConnections,
    (connections) => connections.list
  ).pipe(
    Effect.provide(
      CustomerAgentConnections.fromAuthority({ listConsents }).pipe(
        Layer.provide(
          CustomerAgentClientDirectory.fromAuthority({ findPublicClient })
        )
      )
    ),
    Effect.result,
    Effect.runPromise
  );

describe("CustomerAgentConnections", () => {
  test("names each consented assistant, oldest first, with the scopes it explains and whether it administers", async () => {
    const result = await list(async () => [
      consent("consent-2", helperId, "2026-10-05T08:00:00.000Z", [
        "openid",
        "offline_access",
        "administration",
        "reservations:create",
      ]),
      consent("consent-1", assistantId, new Date("2026-10-01T08:00:00.000Z")),
    ]);

    expect(result).toMatchObject({
      _tag: "Success",
      success: [
        {
          id: "consent-1",
          name: "Synthetic Assistant",
          host: "assistant.invalid",
          scopes: ["reservations:read"],
          administration: false,
          connectedAt: "2026-10-01T08:00:00.000Z",
        },
        {
          id: "consent-2",
          name: "Synthetic Helper",
          host: "helper.invalid",
          // Scopes the consent page can't explain are left out; the rest
          // keep its order. Administration is flagged on its own.
          scopes: ["reservations:create", "offline_access"],
          administration: true,
          connectedAt: "2026-10-05T08:00:00.000Z",
        },
      ],
    });
  });

  test("lists nothing for a customer without consents", async () => {
    expect(await list(async () => [])).toMatchObject({
      _tag: "Success",
      success: [],
    });
  });

  test("keeps a consent whose client the server no longer knows, unnamed", async () => {
    const result = await list(async () => [
      consent("consent-gone", "https://gone.invalid/client.json", "2026-10-01"),
    ]);

    expect(result).toMatchObject({
      _tag: "Success",
      success: [{ id: "consent-gone", name: undefined, host: undefined }],
    });
  });

  test("fails unavailable when the consents can't be read", async () => {
    const result = await list(async () => {
      throw new Error("database down");
    });

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAccountAccessError",
        cause: { code: "authentication.agent-connections" },
      },
    });
  });

  test("fails unavailable on a consent it can't read", async () => {
    const result = await list(async () => [{ id: "consent-1" }]);

    expect(result).toMatchObject({ _tag: "Failure" });
  });

  test("keeps a consent whose client metadata can't be read, unnamed", async () => {
    const result = await list(
      async () => [
        consent("consent-1", assistantId, "2026-10-01"),
        consent("consent-2", helperId, "2026-10-02"),
      ],
      async (clientId) => {
        if (clientId === assistantId) throw new Error("metadata host down");
        return publicClients.get(clientId);
      }
    );

    expect(result).toMatchObject({
      _tag: "Success",
      success: [
        { id: "consent-1", name: undefined },
        { id: "consent-2", name: "Synthetic Helper" },
      ],
    });
  });
});
