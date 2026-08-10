import { describe, expect, test } from "bun:test";
import {
  CliAccessToken,
  CliSessionUnauthorized,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { WorkspaceAdminApiClient } from "../api/workspace-admin-api-client.service";
import { CliSessionCredential } from "../credentials/cli-session-credential.service";
import { AuthenticationService } from "./authentication.service";

describe("AuthenticationService", () => {
  test("removes a stored credential when the API reports revocation", async () => {
    const accessToken = Schema.decodeUnknownSync(CliAccessToken)(
      "a".repeat(43)
    );
    let removals = 0;
    const apiLayer = Layer.succeed(WorkspaceAdminApiClient, {
      getInfo: Effect.die("not used"),
      startAuthentication: () => Effect.die("not used"),
      getAuthenticationStatus: () => Effect.die("not used"),
      exchangeGrant: () => Effect.die("not used"),
      getCurrentSession: () =>
        Effect.fail(
          new CliSessionUnauthorized({
            message: "The CLI session has been revoked.",
          })
        ),
    } satisfies WorkspaceAdminApiClient["Service"]);
    const credentialLayer = Layer.succeed(CliSessionCredential, {
      get: Effect.succeed(Redacted.make(accessToken)),
      set: () => Effect.void,
      remove: Effect.sync(() => {
        removals += 1;
        return true;
      }),
    } satisfies CliSessionCredential["Service"]);

    const current = await AuthenticationService.pipe(
      Effect.flatMap((authentication) => authentication.current),
      Effect.provide(AuthenticationService.Live),
      Effect.provide(apiLayer),
      Effect.provide(credentialLayer),
      Effect.runPromise
    );

    expect(Option.isNone(current)).toBe(true);
    expect(removals).toBe(1);
  });
});
