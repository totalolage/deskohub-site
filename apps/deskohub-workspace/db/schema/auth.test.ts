import { describe, expect, test } from "bun:test";
import { passkey } from "@better-auth/passkey";
import { getAuthTables } from "better-auth/db";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { authOptions } from "@/features/account/backend/auth/auth-options";
import {
  authAccount,
  authPasskey,
  authRateLimit,
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

// An acronym such as the passkey `credentialID` is one word.
const snakeCase = (field: string) =>
  field.replace(/[A-Z]+/g, (word) => `_${word.toLowerCase()}`);

const drizzleAuthTables = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  rateLimit: authRateLimit,
  passkey: authPasskey,
};

const uniqueIndexColumns = (table: PgTable) =>
  getTableConfig(table)
    .indexes.filter((index) => index.config.unique)
    .flatMap((index) => index.config.columns.map((column) => column.name));

describe("Better Auth schema", () => {
  // The runtime adds the passkey plugin, the only plugin that brings a table.
  const authTables = getAuthTables({ ...authOptions, plugins: [passkey()] });

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

  test("carries the locale preference as a nullable server-owned user field", () => {
    const fields = authTables.user!.fields as Record<string, BetterAuthField>;
    expect(fields.locale).toMatchObject({
      type: "string",
      required: false,
      input: false,
    });

    const config = getTableConfig(authUser);
    const column = config.columns.find(
      (candidate) => candidate.name === "locale"
    )!;
    expect(column.notNull).toBe(false);
    expect(column.getSQLType()).toBe("text");
    const check = config.checks.find(
      (candidate) => candidate.name === "user_locale_check"
    );
    expect(check).toBeDefined();
    expect(new PgDialect().sqlToQuery(check!.value).sql).toBe(
      `"auth"."user"."locale" in ('en-US', 'cs-CZ')`
    );
  });

  test("keeps one passkey row per WebAuthn credential", () => {
    expect(uniqueIndexColumns(authPasskey)).toEqual(["credential_id"]);
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
