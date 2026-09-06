import { describe, expect, test } from "bun:test";
import { getAuthTables } from "better-auth/db";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { authOptions } from "@/features/account/backend/auth/auth-options";
import {
  authAccount,
  authRateLimit,
  authRelations,
  authSession,
  authUser,
  authVerification,
} from "./auth";

interface BetterAuthField {
  readonly fieldName: string;
  readonly required?: boolean;
  readonly unique?: boolean;
  readonly references?: {
    readonly model: string;
    readonly field: string;
    readonly onDelete?: string;
  };
}

const snakeCase = (field: string) =>
  field.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);

const drizzleAuthTables = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  rateLimit: authRateLimit,
};

const uniqueIndexColumns = (table: PgTable) =>
  getTableConfig(table)
    .indexes.filter((index) => index.config.unique)
    .flatMap((index) => index.config.columns.map((column) => column.name));

describe("Better Auth schema", () => {
  const authTables = getAuthTables(authOptions);

  test("isolates every auth table in the auth schema", () => {
    for (const [model, table] of Object.entries(drizzleAuthTables)) {
      const config = getTableConfig(table);
      expect(config.schema).toBe("auth");
      expect(config.name).toBe(snakeCase(model));
    }
  });

  test("matches the tables Better Auth derives from the connectionless options", () => {
    expect(Object.keys(drizzleAuthTables).sort()).toEqual(
      Object.keys(authTables).sort()
    );

    for (const [model, table] of Object.entries(drizzleAuthTables)) {
      const authTable = authTables[model as keyof typeof authTables]!;
      const config = getTableConfig(table);
      const fields = authTable.fields as Record<string, BetterAuthField>;

      expect(config.columns.map((column) => column.name).sort()).toEqual(
        [
          "id",
          ...Object.entries(fields).map(([key, field]) =>
            snakeCase(field.fieldName ?? key)
          ),
        ].sort()
      );

      for (const [key, field] of Object.entries(fields)) {
        const columnName = snakeCase(field.fieldName ?? key);
        const column = config.columns.find(
          (candidate) => candidate.name === columnName
        )!;

        expect(column.notNull).toBe(field.required ?? false);

        if (field.unique) {
          expect(uniqueIndexColumns(table)).toContain(columnName);
        }

        if (field.references) {
          const foreignKey = config.foreignKeys.find(
            (candidate) => candidate.reference().columns[0]?.name === columnName
          );
          expect(foreignKey).toBeDefined();
          expect(foreignKey!.onDelete).toBe("cascade");
          const referenced = getTableConfig(
            foreignKey!.reference().foreignTable
          );
          expect(referenced.schema).toBe("auth");
          expect(referenced.name).toBe(
            snakeCase(authTables[field.references.model]!.modelName)
          );
          expect(foreignKey!.reference().foreignColumns[0]?.name).toBe("id");
        }
      }
    }
  });

  test("carries deletionRequestedAt as nullable server-owned user state", () => {
    const fields = authTables.user!.fields as Record<string, BetterAuthField>;
    expect(fields.deletionRequestedAt).toMatchObject({
      type: "date",
      required: false,
      input: false,
    });

    const config = getTableConfig(authUser);
    const column = config.columns.find(
      (candidate) => candidate.name === "deletion_requested_at"
    )!;
    expect(column.notNull).toBe(false);
    expect(column.getSQLType()).toBe("timestamp with time zone");
  });

  test("indexes the daily cleanup cutoffs", () => {
    const indexNames = (table: PgTable) =>
      getTableConfig(table).indexes.map((index) => index.config.name);

    expect(indexNames(authSession)).toContain("session_expires_at_idx");
    expect(indexNames(authVerification)).toContain(
      "verification_expires_at_idx"
    );
    expect(indexNames(authRateLimit)).toContain("rate_limit_last_request_idx");
  });

  test("defines relations only for the tables Better Auth joins", () => {
    expect(Object.keys(authRelations).sort()).toEqual([
      "account",
      "session",
      "user",
    ]);
  });

  test("keeps timestamps decoding as Date, not Temporal", () => {
    for (const table of Object.values(drizzleAuthTables)) {
      for (const column of getTableConfig(table).columns) {
        if (column.getSQLType().startsWith("timestamp")) {
          expect(column.getSQLType()).toBe("timestamp with time zone");
          expect(column.columnType).not.toBe("PgCustomColumn");
        }
      }
    }
  });
});
