import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  callHandler,
  makeTestAuth,
  testDatabase,
} from "./auth-handler.test-utils";

// The OAuth provider seeds the MCP resource row when an instance starts.
// Deployments start before migrations run (a preview is Ready before its
// database is migrated), so a missing OAuth table must defer the seed, not
// fail every auth request of the instance. The Drizzle adapter wraps the
// Postgres error, which the patched provider reads through `cause`.
describe.skipIf(!testDatabase)(
  "customer agent resource seed before the OAuth migration",
  () => {
    test("starts and serves auth while the resource table is missing", async () => {
      await testDatabase!.pool.query(
        "alter table auth.oauth_resource rename to oauth_resource_pending"
      );
      try {
        const auth = makeTestAuth();

        const ok = await callHandler(auth, "/ok");
        expect(ok.status).toBe(200);
        const session = await callHandler(auth, "/get-session");
        expect(session.status).toBe(200);
      } finally {
        await testDatabase!.pool.query(
          "alter table auth.oauth_resource_pending rename to oauth_resource"
        );
      }
    });
  }
);
