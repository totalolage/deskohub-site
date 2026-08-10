import { type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";

const pgcryptoOptions = "cipher-algo=aes256,compress-algo=1,unicode-mode=1";

export const encryptAccountingSnapshot = (
  snapshotJson: string,
  secret: string
): SQL<Buffer> =>
  sql<Buffer>`pgp_sym_encrypt(${sensitiveDatabaseParameter(snapshotJson)}, ${sensitiveDatabaseParameter(secret)}, ${pgcryptoOptions})`;

export const decryptAccountingSnapshot = (
  encryptedSnapshot: PgColumn,
  secret: string
): SQL<string> =>
  sql<string>`pgp_sym_decrypt(${encryptedSnapshot}, ${sensitiveDatabaseParameter(secret)})`;
