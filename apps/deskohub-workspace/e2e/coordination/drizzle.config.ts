import { defineConfig } from "drizzle-kit";
import { normalizePostgresConnectionUrl } from "../../db/postgres-connection-url";

const adminDatabaseUrl =
  process.env.WORKSPACE_E2E_COORDINATOR_ADMIN_DATABASE_URL;

export default defineConfig({
  ...(adminDatabaseUrl
    ? {
        dbCredentials: {
          url: normalizePostgresConnectionUrl(adminDatabaseUrl),
        },
      }
    : undefined),
  dialect: "postgresql",
  out: "./e2e/coordination/migrations",
  schema: "./e2e/coordination/schema.ts",
});
