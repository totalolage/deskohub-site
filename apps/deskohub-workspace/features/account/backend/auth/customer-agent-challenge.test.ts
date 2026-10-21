import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { buildCustomerAgentChallenge } from "./customer-agent-challenge";

const resource = "https://workspace.deskohub.test/api/mcp";
const metadata =
  "https://workspace.deskohub.test/.well-known/oauth-protected-resource/api/mcp";

const challengeFor = (
  reason: Parameters<typeof buildCustomerAgentChallenge>[0]
) => Effect.runSync(buildCustomerAgentChallenge(reason, resource));

describe("buildCustomerAgentChallenge", () => {
  test("points a request without a token at the resource metadata and the scopes to ask for", () => {
    expect(
      challengeFor({ kind: "missing-token", scopes: ["reservations:create"] })
    ).toEqual({
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadata}", scope="reservations:create"`,
      },
    });
  });

  test("names invalid_token for a token that grants nothing", () => {
    expect(challengeFor({ kind: "invalid-token" })).toEqual({
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadata}", error="invalid_token"`,
      },
    });
  });

  test("answers a missing scope with a 403 insufficient_scope challenge", () => {
    expect(
      challengeFor({
        kind: "insufficient-scope",
        scopes: ["reservations:read"],
      })
    ).toEqual({
      status: 403,
      headers: {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="reservations:read", resource_metadata="${metadata}", error_description="The access token lacks a scope this tool needs"`,
      },
    });
  });
});
