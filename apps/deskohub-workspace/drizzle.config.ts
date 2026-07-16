import { defineConfig } from "drizzle-kit";
import { Schema } from "effect";
import { normalizePostgresConnectionUrl } from "./db/postgres-connection-url";
import { workspaceServerEnvSchema } from "./env.schema";

const { DATABASE_URL, DATABASE_URL_UNPOOLED } = Schema.decodeUnknownSync(
  Schema.Struct({
    DATABASE_URL: workspaceServerEnvSchema.fields.DATABASE_URL,
    DATABASE_URL_UNPOOLED:
      workspaceServerEnvSchema.fields.DATABASE_URL_UNPOOLED,
  })
)({
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
