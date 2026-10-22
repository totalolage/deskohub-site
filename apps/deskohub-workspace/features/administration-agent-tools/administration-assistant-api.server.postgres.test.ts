import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { handleWorkspaceAdminApiRequest } from "@/features/admin-cli/workspace-admin-api.server";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)("the CLI route on disposable Postgres", () => {
  test("refuses an OAuth access token shaped like a CLI bearer", async () => {
    // 32 random bytes in base64url: the CLI bearer's 43 characters, so
    // the CLI looks it up instead of rejecting its shape.
    const token = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32))
    ).toString("base64url");

    for (const path of ["/sessions", "/session"]) {
      const response = await handleWorkspaceAdminApiRequest(
        new Request(`https://workspace.deskohub.test/api/v1/cli${path}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      );

      expect(token).toHaveLength(43);
      expect([
        response.status,
        ((await response.json()) as { readonly _tag?: string })._tag,
      ]).toEqual([401, "CliSessionUnauthorized"]);
    }
  });
});
