import { defineConfig } from "drizzle-kit";
import { normalizePostgresConnectionUrl } from "./db/postgres-connection-url";
import { workspaceServerEnvSchema } from "./env.schema";

const { DATABASE_URL, DATABASE_URL_UNPOOLED } = workspaceServerEnvSchema
  .pick({ DATABASE_URL: true, DATABASE_URL_UNPOOLED: true })
  .parse({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
  });

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: normalizePostgresConnectionUrl(DATABASE_URL_UNPOOLED ?? DATABASE_URL),
  },
});
