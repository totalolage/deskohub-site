import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Cause, Effect, Exit } from "effect";
import { E2EDatabase } from "../integrations/database.service";
import { removeSyntheticAccountLink } from "./auth-rows";

type SyntheticLink = {
  readonly customerAccountId: string;
  dotyposCustomerId: string | null;
};

const makeFakeDatabase = (input: {
  readonly rows: readonly SyntheticLink[];
  readonly returnedRows?: readonly { readonly customerAccountId: string }[];
}) => {
  const rows = [...input.rows];
  const captured: { set?: Record<string, unknown>; where?: SQL } = {};

  const db = {
    update: (_table: unknown) => {
      return {
        set: (values: Record<string, unknown>) => {
          captured.set = values;
          return {
            where: (condition: SQL) => {
              captured.where = condition;
              return {
                returning: (_selection: Record<string, unknown>) => {
                  return Effect.sync(() => {
                    const { params } = new PgDialect().sqlToQuery(condition);
                    const [accountId, customerId] = params;
                    const updated = rows.filter(
                      (row) =>
                        row.customerAccountId === accountId &&
                        row.dotyposCustomerId === customerId
                    );
                    for (const row of updated) {
                      row.dotyposCustomerId = values.dotyposCustomerId as
                        | string
                        | null;
                    }
                    return (
                      input.returnedRows ??
                      updated.map(({ customerAccountId }) => ({
                        customerAccountId,
                      }))
                    );
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  return { captured, db, rows };
};

const runRemoveSyntheticAccountLink = async (
  accountId: string,
  customerId: string,
  database: ReturnType<typeof makeFakeDatabase>
) =>
  Effect.runPromiseExit(
    removeSyntheticAccountLink(accountId, customerId).pipe(
      Effect.provideService(
        E2EDatabase,
        E2EDatabase.of({ db: database.db as never })
      )
    )
  );

describe("removeSyntheticAccountLink", () => {
  test("clears only the exact account link and preserves other synthetic records", async () => {
    const accountId = "account-target";
    const customerId = "customer-target";
    const database = makeFakeDatabase({
      rows: [
        { customerAccountId: accountId, dotyposCustomerId: customerId },
        {
          customerAccountId: "account-other",
          dotyposCustomerId: "customer-other",
        },
      ],
    });

    const exit = await runRemoveSyntheticAccountLink(
      accountId,
      customerId,
      database
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(database.rows).toEqual([
      {
        customerAccountId: accountId,
        dotyposCustomerId: null,
      },
      {
        customerAccountId: "account-other",
        dotyposCustomerId: "customer-other",
      },
    ]);
    expect(database.captured.where).toBeDefined();
    expect(database.captured.set).toEqual({ dotyposCustomerId: null });
    const query = new PgDialect().sqlToQuery(database.captured.where!);
    expect(query.sql).toBe(
      '(("customer_accounts"."id" = $1) and ("customer_accounts"."dotypos_customer_id" = $2))'
    );
    expect(query.params).toEqual([accountId, customerId]);
  });

  test.each([
    {
      name: "missing",
      returnedRows: [],
    },
    {
      name: "mismatched",
      returnedRows: [{ customerAccountId: "account-other" }],
    },
  ])(
    "fails closed when the deleted link is $name",
    async ({ returnedRows }) => {
      const accountId = "account-target";
      const customerId = "customer-target";
      const database = makeFakeDatabase({
        returnedRows,
        rows: [{ customerAccountId: accountId, dotyposCustomerId: customerId }],
      });

      const exit = await runRemoveSyntheticAccountLink(
        accountId,
        customerId,
        database
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) return;
      const error = Cause.squash(exit.cause);
      expect(error).toMatchObject({
        diagnosticCode: "postgres_account_fixture_assertion_failed",
        message:
          "Synthetic account link cleanup did not remove exactly one matching row",
        operation: "delete synthetic account link",
      });
      expect(JSON.stringify(error)).not.toContain(accountId);
      expect(JSON.stringify(error)).not.toContain(customerId);
    }
  );
});
