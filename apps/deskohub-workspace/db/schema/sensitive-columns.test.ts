/**
 * The database query logger writes every statement's bound parameters at Info
 * level and blanks only those marked sensitive. `sensitiveText` columns mark
 * every value Drizzle binds through the column's encoder, so this suite
 * enumerates them from the schema and drives each through the real query
 * logger.
 *
 * Values bound outside the encoder stay visible unless the call site marks
 * them: raw `sql` templates, `like`-style operators, comparisons whose left
 * side is an expression such as `lower(column)`, and `sql.param`,
 * `sql.placeholder`, `sql.raw`, or `sql` values compared with or written to a
 * sensitive column. A static scan of the app's non-test modules flags those.
 * It errs on the strict side: a template that references a sensitive column
 * and binds any unmarked value is flagged even when the value belongs to
 * another column, so mark it or split the template. It resolves tables by
 * their schema export names and import renames, so it misses a table reached
 * through another binding, and it does not read relational-query filter
 * objects or written rows built away from their `values` or `set` call.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  type Column,
  eq,
  getTableColumns,
  inArray,
  is,
  ne,
  or,
  SQL,
} from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import ts from "typescript";
import { WorkspaceDatabase } from "@/db/database.service";
import { commandOutput } from "@/scripts/shared/command";
import { getSensitiveDatabaseQueryParameterIndexes } from "@/shared/backend/logging/database-query-parameter-classifier";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import * as authSchema from "./auth";
import * as workspaceSchema from "./index";

const dialect = new PgDialect();

const isSensitiveColumn = (column: Column) => {
  const encoded = column.mapToDriverValue("synthetic");
  return (
    is(encoded, SQL) &&
    getSensitiveDatabaseQueryParameterIndexes(dialect.sqlToQuery(encoded).sql)
      .size > 0
  );
};

// Drizzle-kit generates migrations from exactly these two modules.
const tables = Object.entries({ ...workspaceSchema, ...authSchema })
  .filter((entry): entry is [string, PgTable] => is(entry[1], PgTable))
  .map(([exportName, table]) => {
    const config = getTableConfig(table);
    return {
      exportName,
      table,
      id: `${config.schema ?? "public"}.${config.name}`,
    };
  });

const columns = tables.flatMap(({ exportName, table, id }) =>
  Object.entries(getTableColumns(table)).map(([key, column]) => ({
    id: `${id}.${column.name}`,
    exportName,
    key,
    table,
    column,
    words: column.name.split("_"),
    sqlType: column.getSQLType(),
    sensitive: isSensitiveColumn(column),
  }))
);

const sensitiveColumns = columns.filter(({ sensitive }) => sensitive);

// Column-name word sequences that indicate a secret or a value identifying a
// person. A fragment matches a whole run of words, so "token" also covers
// "grant_token" and "token_hash".
const sensitiveColumnFragments = [
  "email",
  "token",
  "secret",
  "password",
  "code_hash",
  "access_code",
  "ip_address",
  "user_agent",
  "redirect_url",
].map((fragment) => fragment.split("_"));

// Sensitive columns whose names don't say so.
const sensitiveColumnsWithoutTelltaleNames = [
  // Bearer discount, voucher, and referral codes customers type in.
  "public.promotion_codes.code",
  "public.discount_codes.code",
  // Magic-link and verification tokens, keyed by the login email.
  "auth.verification.identifier",
  "auth.verification.value",
  // Rate-limit keys carry the client IP.
  "auth.rate_limit.key",
  // A customer-written passkey label can carry their name.
  "auth.passkey.name",
  // The encrypted copy of a refresh response, replayed within the reuse window.
  "auth.oauth_refresh_token.rotation_replay_response",
];

const nonSensitiveColumns = new Map([
  [
    "public.workspace_reservations.active_customer_email_delivery_id",
    "email provider delivery ID",
  ],
  [
    "public.workspace_reservations.active_customer_email_delivery_locale",
    "customer email delivery locale",
  ],
  [
    "auth.oauth_client.token_endpoint_auth_method",
    "OAuth client authentication method name",
  ],
]);

const containsWordRun = (
  words: readonly string[],
  fragment: readonly string[]
) =>
  words.some((_, start) =>
    fragment.every((word, offset) => words[start + offset] === word)
  );

describe("sensitive schema columns", () => {
  test("stores columns named for secrets or personal identifiers as sensitive text", () => {
    const unmarked = columns
      .filter(
        ({ id, words, sqlType, sensitive }) =>
          sqlType === "text" &&
          !sensitive &&
          !nonSensitiveColumns.has(id) &&
          sensitiveColumnFragments.some((fragment) =>
            containsWordRun(words, fragment)
          )
      )
      .map(({ id }) => id);

    expect(unmarked).toEqual([]);
    expect(sensitiveColumns.map(({ id }) => id)).toEqual(
      expect.arrayContaining(sensitiveColumnsWithoutTelltaleNames)
    );
  });

  test("keeps every listed column backed by a real column", () => {
    const columnIds = columns.map(({ id }) => id);

    for (const id of [
      ...sensitiveColumnsWithoutTelltaleNames,
      ...nonSensitiveColumns.keys(),
    ]) {
      expect(columnIds).toContain(id);
    }
  });

  test("keeps sensitive columns plain text in the database", () => {
    expect(sensitiveColumns.length).toBeGreaterThan(0);
    for (const { sqlType } of sensitiveColumns) {
      expect(sqlType).toBe("text");
    }
  });

  test.each(sensitiveColumns.map(({ id }, index) => [id, index] as const))(
    "censors %s in written and compared values",
    async (_, index) => {
      const { table, key, column } = sensitiveColumns[index]!;
      const recording = await makeRecordingWorkspaceDatabase();
      const value = (statement: string) =>
        `synthetic-sensitive-${index}-${statement}`;
      const values = [
        "insert",
        "conflict-insert",
        "conflict-set",
        "update",
        "update-where",
        "eq",
        "ne",
        "in-first",
        "in-second",
        "delete",
      ].map(value);

      const logs = await collectDatabaseQueryLogs(
        Effect.gen(function* () {
          const { db } = yield* WorkspaceDatabase;
          yield* db.insert(table).values({ [key]: value("insert") } as never);
          yield* db
            .insert(table)
            .values({ [key]: value("conflict-insert") } as never)
            .onConflictDoUpdate({
              target: column,
              set: { [key]: value("conflict-set") } as never,
            });
          yield* db
            .update(table)
            .set({ [key]: value("update") } as never)
            .where(eq(column, value("update-where")));
          yield* db
            .select()
            .from(table)
            .where(
              or(
                eq(column, value("eq")),
                ne(column, value("ne")),
                inArray(column, [value("in-first"), value("in-second")])
              )
            );
          yield* db.delete(table).where(eq(column, value("delete")));
        }).pipe(Effect.provide(recording.layer))
      );

      expect(recording.statements).toHaveLength(5);
      expectQueryLogsToCensor({ recording, logs, values });
    }
  );
});

const appRoot = resolve(import.meta.dir, "../..");
const scannedModule = /(?<!\.d)\.(?:ts|tsx)$/;
const testModule = /\.test\.tsx?$/;
const schemaModule = /(?:^|\/)schema(?:\/[\w-]+)?$/;

// Operators whose value skips the column encoder even on a bare column.
const encoderSkippingOperators = new Set([
  "like",
  "ilike",
  "notLike",
  "notIlike",
]);
// Operators that encode the value only when their left side is a bare column.
const comparisonOperators = new Set([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "inArray",
  "notInArray",
  ...encoderSkippingOperators,
]);

// Calls that put a value into SQL without a column: `sql.param`,
// `sql.placeholder`, and `sql.raw`, or the bare `param` and `placeholder`.
const rawSqlValueFunctions = new Set(["param", "placeholder", "raw"]);

const sensitiveColumnKeys = Map.groupBy(
  sensitiveColumns,
  ({ exportName }) => exportName
);

/** Maps each local binding of a schema table export to that export's name. */
const schemaTableBindings = (source: ts.SourceFile) => {
  const bindings = new Map<string, string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !schemaModule.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const namedBindings = statement.importClause?.namedBindings;
    if (!(namedBindings && ts.isNamedImports(namedBindings))) continue;
    for (const element of namedBindings.elements) {
      const exportName = (element.propertyName ?? element.name).text;
      if (sensitiveColumnKeys.has(exportName)) {
        bindings.set(element.name.text, exportName);
      }
    }
  }
  return bindings;
};

const findSensitiveColumnsBoundOutsideTheirEncoder = (
  path: string,
  sourceText: string
) => {
  const source = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  const bindings = schemaTableBindings(source);
  if (bindings.size === 0) return [];

  const isSensitiveColumnReference = (node: ts.Node) => {
    if (
      !(ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression))
    ) {
      return false;
    }
    const exportName = bindings.get(node.expression.text);
    return (
      exportName !== undefined &&
      (sensitiveColumnKeys.get(exportName) ?? []).some(
        ({ key }) => key === node.name.text
      )
    );
  };
  const referencesSensitiveColumn = (node: ts.Node): boolean =>
    isSensitiveColumnReference(node) ||
    (ts.forEachChild(node, referencesSensitiveColumn) ?? false);
  const isMarked = (node: ts.Expression) =>
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "sensitiveDatabaseParameter";
  // A template span that binds no value: a column or table reference.
  const isReference = (node: ts.Expression) =>
    (ts.isIdentifier(node) && bindings.has(node.text)) ||
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      bindings.has(node.expression.text));
  const isSqlTemplate = (
    node: ts.Node
  ): node is ts.TaggedTemplateExpression & {
    readonly template: ts.TemplateExpression;
  } =>
    ts.isTaggedTemplateExpression(node) &&
    ts.isIdentifier(node.tag) &&
    node.tag.text === "sql" &&
    ts.isTemplateExpression(node.template);
  const bindsUnmarkedValue = (template: ts.TemplateExpression) =>
    template.templateSpans.some(
      ({ expression }) => !(isReference(expression) || isMarked(expression))
    );
  // SQL that the column encoder never sees: a template binding a value, or a
  // raw parameter, placeholder, or inlined string.
  const isEncoderSkippingValue = (node: ts.Expression) =>
    (isSqlTemplate(node) && bindsUnmarkedValue(node.template)) ||
    (ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "sql" &&
        rawSqlValueFunctions.has(node.expression.name.text)) ||
        (ts.isIdentifier(node.expression) &&
          rawSqlValueFunctions.has(node.expression.text))));
  const isWrittenRow = (row: ts.ObjectLiteralExpression) => {
    const parent = ts.isArrayLiteralExpression(row.parent)
      ? row.parent.parent
      : row.parent;
    if (
      ts.isCallExpression(parent) &&
      ts.isPropertyAccessExpression(parent.expression)
    ) {
      return ["values", "set"].includes(parent.expression.name.text);
    }
    return (
      ts.isPropertyAssignment(parent) &&
      ts.isIdentifier(parent.name) &&
      parent.name.text === "set"
    );
  };
  const sensitiveKeys = new Set(
    [...bindings.values()].flatMap((exportName) =>
      (sensitiveColumnKeys.get(exportName) ?? []).map(({ key }) => key)
    )
  );

  const findings: string[] = [];
  const report = (node: ts.Node) => {
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source)
    );
    findings.push(`${path}:${line + 1}`);
  };
  const visit = (node: ts.Node): void => {
    if (
      isSqlTemplate(node) &&
      node.template.templateSpans.some(({ expression }) =>
        isSensitiveColumnReference(expression)
      ) &&
      bindsUnmarkedValue(node.template)
    ) {
      report(node);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      comparisonOperators.has(node.expression.text)
    ) {
      const [left, right] = node.arguments;
      const bypassesEncoder =
        left !== undefined &&
        (encoderSkippingOperators.has(node.expression.text) ||
        !isSensitiveColumnReference(left)
          ? referencesSensitiveColumn(left) && !(right && isMarked(right))
          : right !== undefined && isEncoderSkippingValue(right));
      if (bypassesEncoder) report(node);
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      sensitiveKeys.has(node.name.text) &&
      ts.isObjectLiteralExpression(node.parent) &&
      isWrittenRow(node.parent) &&
      isEncoderSkippingValue(node.initializer)
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
};

describe("sensitive column values bound outside the column encoder", () => {
  test("flags unmarked values the scan can see", () => {
    const source = `
      import { promotionCodes as codes } from "@/db/schema";
      sql\`\${codes.code} = \${value}\`;
      sql\`\${codes.code} = \${sensitiveDatabaseParameter(value)}\`;
      sql\`\${codes.code} is not null and \${codes.kind} = 'referral'\`;
      ilike(codes.code, pattern);
      eq(sql\`lower(\${codes.code})\`, value);
      eq(sql\`lower(\${codes.code})\`, sensitiveDatabaseParameter(value));
      eq(codes.code, value);
      inArray(codes.code, values);
      eq(codes.code, sql.param(value));
      eq(codes.code, sql.placeholder("code"));
      eq(codes.code, sql\`\${value}\`);
      db.update(codes).set({ code: sql\`upper(\${value})\` });
      db.insert(codes).values([{ code: sql.raw(value) }]);
      db.insert(codes).values({ code: value }).onConflictDoUpdate({
        target: codes.code,
        set: { code: sql.param(value) },
      });
      db.update(codes).set({ code: excludedColumn(codes.code) });
    `;

    expect(
      findSensitiveColumnsBoundOutsideTheirEncoder("fixture.ts", source)
    ).toEqual([
      "fixture.ts:3",
      "fixture.ts:6",
      "fixture.ts:7",
      "fixture.ts:11",
      "fixture.ts:12",
      "fixture.ts:13",
      "fixture.ts:14",
      "fixture.ts:15",
      "fixture.ts:18",
    ]);
  });

  test("are marked where the app binds them", async () => {
    const listing = await commandOutput(
      ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: appRoot }
    );
    const paths = listing
      .split("\0")
      .filter((path) => scannedModule.test(path) && !testModule.test(path));

    const findings: string[] = [];
    for (const path of paths) {
      const sourceText = await Bun.file(resolve(appRoot, path)).text();
      if (!sourceText.includes("schema")) continue;
      findings.push(
        ...findSensitiveColumnsBoundOutsideTheirEncoder(path, sourceText)
      );
    }

    expect(findings).toEqual([]);
  });
});
