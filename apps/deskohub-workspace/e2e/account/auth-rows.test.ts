import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Cause, Effect, Exit } from "effect";
import { customerAccountLinks } from "@/db/schema/customer-account-links";
import { E2EDatabase } from "../integrations/database.service";
import {
  classifyWorkspaceE2EAccountState,
  removeSyntheticAccountLink,
  type WorkspaceE2EAccountState,
} from "./auth-rows";

describe("workspace account e2e account state classification", () => {
  test("classifies an absent synthetic account as missing", () => {
    expect(
      classifyWorkspaceE2EAccountState({
        authUserId: undefined,
        linkedDotyposCustomerId: undefined,
      })
    ).toBe("missing");
  });

  test("classifies a verified account without a link as unlinked", () => {
    expect(
      classifyWorkspaceE2EAccountState({
        authUserId: "auth-user-1",
        linkedDotyposCustomerId: undefined,
      })
    ).toBe("unlinked");
  });

  test("classifies a completed profile completion as linked", () => {
    expect(
      classifyWorkspaceE2EAccountState({
        authUserId: "auth-user-1",
        linkedDotyposCustomerId: "dotypos-customer-1",
      })
    ).toBe("linked");
  });

  test("keeps the state values fixed and low-cardinality", () => {
    const states: readonly WorkspaceE2EAccountState[] = [
      "linked",
      "missing",
      "unlinked",
    ];
    expect([...states].sort()).toEqual(["linked", "missing", "unlinked"]);
  });
});

type SyntheticLink = {
  readonly customerAccountId: string;
  readonly dotyposCustomerId: string;
};

const makeFakeDatabase = (input: {
  readonly rows: readonly SyntheticLink[];
  readonly returnedRows?: readonly { readonly customerAccountId: string }[];
}) => {
  const rows = [...input.rows];
  const captured: {
    table?: unknown;
    where?: SQL;
    returning?: Record<string, unknown>;
  } = {};

  const db = {
    delete: (table: unknown) => {
      captured.table = table;
      return {
        where: (condition: SQL) => {
          captured.where = condition;
          return {
            returning: (selection: Record<string, unknown>) => {
              captured.returning = selection;
              return Effect.sync(() => {
                const { params } = new PgDialect().sqlToQuery(condition);
                const [accountId, customerId] = params;
                const deleted = rows.filter(
                  (row) =>
                    row.customerAccountId === accountId &&
                    row.dotyposCustomerId === customerId
                );
                rows.splice(
                  0,
                  rows.length,
                  ...rows.filter((row) => !deleted.includes(row))
                );
                return (
                  input.returnedRows ??
                  deleted.map(({ customerAccountId }) => ({
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
  test("deletes only the exact account link and preserves other synthetic records", async () => {
    const accountId = "account-target";
    const customerId = "customer-target";
    const database = makeFakeDatabase({
      rows: [
        { customerAccountId: accountId, dotyposCustomerId: customerId },
        {
          customerAccountId: accountId,
          dotyposCustomerId: "customer-other-for-account",
        },
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
        dotyposCustomerId: "customer-other-for-account",
      },
      {
        customerAccountId: "account-other",
        dotyposCustomerId: "customer-other",
      },
    ]);
    expect(database.captured.table).toBe(customerAccountLinks);
    expect(database.captured.returning).toEqual({
      customerAccountId: customerAccountLinks.customerAccountId,
    });
    expect(database.captured.where).toBeDefined();
    const query = new PgDialect().sqlToQuery(database.captured.where!);
    expect(query.sql).toBe(
      '(("customer_account_links"."customer_account_id" = $1) and ("customer_account_links"."dotypos_customer_id" = $2))'
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
