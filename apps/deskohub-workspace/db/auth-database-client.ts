import { defineRelations } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { authRelations, drizzleAuthTables } from "./schema/auth";

/**
 * Full Relations-v2 graph over the auth tables only. The joins themselves come
 * from the Better Auth relations part in db/schema/auth.ts (the single source
 * of truth); rc.4 parts are plain per-table entry maps, not callable builders,
 * so the part's relation records are registered inside a full
 * `defineRelations` over the auth table map.
 */
const authRelationsGraph = defineRelations(drizzleAuthTables, () => ({
  user: authRelations.user.relations,
  session: authRelations.session.relations,
  account: authRelations.account.relations,
}));

/** Conventional node-postgres Drizzle facade for Better Auth persistence. */
export type AuthDatabase = NodePgDatabase<typeof authRelationsGraph>;

export const makeAuthDatabase = (pool: Pool): AuthDatabase =>
  drizzle({ client: pool, relations: authRelationsGraph });
