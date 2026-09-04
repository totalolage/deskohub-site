import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { AdministrationInvoiceId } from "@deskohub/workspace-admin-api";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { Cause, Effect, Layer, Schema } from "effect";
import { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import { InvoiceBreadcrumbService } from "./invoice-breadcrumb.service";

const invoiceId = Schema.decodeUnknownSync(AdministrationInvoiceId)(
  "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb33"
);
const missingInvoiceId = Schema.decodeUnknownSync(AdministrationInvoiceId)(
  "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb34"
);

type InvoiceNumberRow = { readonly invoiceNumber: string };

const compileSql = (chunk: SQL) =>
  new PgDialect().sqlToQuery(sql`${chunk}`).sql;

type CapturedSelect = {
  readonly fields: Record<string, SQL>;
  readonly where: (SQL | undefined)[];
};

const makeQuery = (
  result: Effect.Effect<readonly InvoiceNumberRow[], EffectDrizzleQueryError>,
  captured: CapturedSelect
) => {
  const query = result as Effect.Effect<
    readonly InvoiceNumberRow[],
    EffectDrizzleQueryError
  > & {
    from: () => typeof query;
    limit: () => typeof query;
    where: (condition: SQL | undefined) => typeof query;
  };
  query.from = () => query;
  query.where = (condition) => {
    captured.where.push(condition);
    return query;
  };
  query.limit = () => query;
  return query;
};

const makeDatabase = (
  result: Effect.Effect<readonly InvoiceNumberRow[], EffectDrizzleQueryError>
) => {
  const selects: CapturedSelect[] = [];
  const db = {
    select: (fields: Record<string, SQL>) => {
      const captured: CapturedSelect = { fields, where: [] };
      selects.push(captured);
      return makeQuery(result, captured);
    },
  };
  return { db, selects };
};

const provideDatabase = (database: ReturnType<typeof makeDatabase>["db"]) =>
  InvoiceBreadcrumbService.Default.pipe(
    Layer.provide(
      Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db: database as never })
      )
    )
  );

describe("InvoiceBreadcrumbService", () => {
  test("projects the breadcrumb label from only the invoice number column", async () => {
    const { db, selects } = makeDatabase(
      Effect.succeed([{ invoiceNumber: "2026042" }])
    );

    const label = await Effect.gen(function* () {
      const breadcrumb = yield* InvoiceBreadcrumbService;
      return yield* breadcrumb.getLabel(invoiceId);
    }).pipe(Effect.provide(provideDatabase(db)), Effect.runPromise);

    expect(label).toBe("Invoice 2026042");
    expect(selects).toHaveLength(1);
    expect(Object.keys(selects[0]!.fields)).toEqual(["invoiceNumber"]);
    expect(compileSql(selects[0]!.where[0]!)).toBe('"invoices"."id" = $1');
  });

  test("returns no label when the invoice row is missing", async () => {
    const { db, selects } = makeDatabase(Effect.succeed([]));

    const label = await Effect.gen(function* () {
      const breadcrumb = yield* InvoiceBreadcrumbService;
      return yield* breadcrumb.getLabel(missingInvoiceId);
    }).pipe(Effect.provide(provideDatabase(db)), Effect.runPromise);

    expect(label).toBeNull();
    expect(selects).toHaveLength(1);
  });

  test("propagates invoice read failures", async () => {
    const failure = new EffectDrizzleQueryError({
      query: "select 1",
      params: [],
      cause: Cause.fail(
        new SqlError.SqlError({
          reason: new SqlError.UnknownError({
            cause: new Error("connection refused"),
            message: "connection refused",
            operation: "connect",
          }),
        })
      ),
    });
    const { db, selects } = makeDatabase(Effect.fail(failure));

    const error = await Effect.gen(function* () {
      const breadcrumb = yield* InvoiceBreadcrumbService;
      return yield* Effect.flip(breadcrumb.getLabel(invoiceId));
    }).pipe(Effect.provide(provideDatabase(db)), Effect.runPromise);

    expect(error).toBe(failure);
    expect(selects).toHaveLength(1);
  });
});
