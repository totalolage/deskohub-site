import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { authOauthClient, authOauthClientResource } from "@/db/schema/auth";
import type { WorkspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import {
  customerAgentRedirectUri,
  customerAgentRequestedScopes,
} from "./authorization";

export type CustomerAgentClient = {
  readonly clientId: string;
  readonly name: string;
};

/**
 * Registers a synthetic public OAuth client, as an administrator registers a
 * pre-registered agent: no secret, so PKCE is required, the authorization
 * code and refresh grants, and the case's MCP resource. It is owned by the
 * case's journaled account, so deleting that account cascades it, its
 * resource link, consents, and tokens away even after an interruption.
 *
 * A real agent registers through a Client ID Metadata Document, but a
 * protected preview can't fetch one; the Postgres flow test covers that.
 */
export const seedCustomerAgentClient = ({
  ownerAccountId,
  resource,
}: {
  readonly ownerAccountId: string;
  readonly resource: string;
}): Effect.Effect<CustomerAgentClient, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const now = new Date();
    const client = {
      clientId: `workspace-e2e-agent-${crypto.randomUUID()}`,
      name: "Workspace E2E Agent",
    } satisfies CustomerAgentClient;
    yield* runDatabaseOperation(
      "seed customer agent client",
      db.transaction(
        Effect.fn(function* (tx) {
          yield* tx.insert(authOauthClient).values({
            applicationType: "web",
            clientId: client.clientId,
            createdAt: now,
            grantTypes: ["authorization_code", "refresh_token"],
            id: crypto.randomUUID(),
            name: client.name,
            redirectUris: [customerAgentRedirectUri],
            requirePKCE: true,
            responseTypes: ["code"],
            scopes: [...customerAgentRequestedScopes],
            tokenEndpointAuthMethod: "none",
            updatedAt: now,
            userId: ownerAccountId,
          });
          // The OAuth server links every client it registers to the MCP
          // resource; tokens can be bound only to a linked resource.
          yield* tx.insert(authOauthClientResource).values({
            clientId: client.clientId,
            createdAt: now,
            id: crypto.randomUUID(),
            resourceId: resource,
          });
        })
      )
    );
    return client;
  });

/** Deletes the client; its resource link, consents, and tokens cascade. */
export const removeCustomerAgentClient = (
  client: Pick<CustomerAgentClient, "clientId">
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "remove customer agent client",
      db
        .delete(authOauthClient)
        .where(eq(authOauthClient.clientId, client.clientId))
    );
  });
