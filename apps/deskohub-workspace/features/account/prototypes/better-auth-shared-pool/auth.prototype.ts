/**
 * THROWAWAY PROTOTYPE for GitHub issue "Prove Better Auth on Workspace's
 * shared Postgres pool". This branch is evidence, not production code.
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { makeDatabasePool } from "@/db/database-client";
import * as authSchema from "@/db/schema/better-auth.prototype";
import { authRelations } from "@/db/schema/better-auth.prototype";

let pendingMagicLink: string | undefined;

export const prototypePool = makeDatabasePool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://prototype:prototype@127.0.0.1/prototype",
  max: 2,
});

export const prototypePromiseDatabase = drizzle({
  client: prototypePool,
  relations: authRelations,
});

export const auth = betterAuth({
  baseURL: "http://localhost:3000",
  secret: "throwaway-prototype-secret-at-least-32-characters",
  trustedOrigins: ["http://localhost:3000"],
  database: drizzleAdapter(prototypePromiseDatabase, {
    provider: "pg",
    schema: authSchema,
    transaction: true,
  }),
  plugins: [
    magicLink({
      sendMagicLink: async ({ url }) => {
        pendingMagicLink = url;
      },
    }),
  ],
});

export const takePrototypeMagicLink = () => {
  const link = pendingMagicLink;
  pendingMagicLink = undefined;
  if (!link) throw new Error("Better Auth did not issue a magic link");
  return link;
};
