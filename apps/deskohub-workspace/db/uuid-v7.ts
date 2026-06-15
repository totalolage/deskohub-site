import { sql } from "drizzle-orm";

export const postgresUuidV7 = sql<string>`uuid_generate_v7()::text`;
