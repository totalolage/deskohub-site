import { describe, expect, test } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Cause, Effect, Exit } from "effect";
import { E2EDatabase } from "../integrations/database.service";
import { removeSyntheticAccountLink } from "./auth-rows";

type SyntheticLink = {
  readonly customerAccountId: string;
  readonly dotyposCustomerId: string;
};

type SyntheticAccount = {
  readonly dotyposCustomerId: string | null;
  readonly id: string;
};

type ReturnedAccountRows = readonly { readonly customerAccountId: string }[];

const exactMatchParams = (condition: SQL) => {
  const { params } = new PgDialect().sqlToQuery(condition);
  const [accountId, customerId] = params;
  return { accountId, customerId };
};

const makeFakeDatabase = (input: {
  readonly accounts?: readonly SyntheticAccount[];
  readonly links: readonly SyntheticLink[];
  readonly returnedAccountRows?: ReturnedAccountRows;
  readonly returnedLinkRows?: ReturnedAccountRows;
}) => {
  const links = [...input.links];
  const accounts = [...(input.accounts ?? [])];
  const captured: { accountWhere?: SQL; linkWhere?: SQL } = {};

  const tx = {
    delete: (_table: unknown) => ({
      where: (condition: SQL) => {
        captured.linkWhere = condition;
        return {
          returning: (_selection: Record<string, unknown>) =>
            Effect.sync(() => {
              const { accountId, customerId } = exactMatchParams(condition);
              const deleted = links.filter(
                (row) =>
                  row.customerAccountId === accountId &&
                  row.dotyposCustomerId === customerId
              );
              links.splice(
                0,
                links.length,
                ...links.filter((row) => !deleted.includes(row))
              );
              return (
                input.returnedLinkRows ??
                deleted.map(({ customerAccountId }) => ({ customerAccountId }))
              );
            }),
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (_values: Record<string, unknown>) => ({
        where: (condition: SQL) => {
          captured.accountWhere = condition;
          return {
            returning: (_selection: Record<string, unknown>) =>
              Effect.sync(() => {
                const { accountId, customerId } = exactMatchParams(condition);
                const cleared: { customerAccountId: string }[] = [];
                accounts.forEach((row, index) => {
                  if (
                    row.id === accountId &&
                    row.dotyposCustomerId === customerId
                  ) {
                    accounts[index] = { ...row, dotyposCustomerId: null };
                    cleared.push({ customerAccountId: row.id });
                  }
                });
                return input.returnedAccountRows ?? cleared;
              }),
          };
        },
      }),
    }),
  };

  const db = {
    transaction: <A, E, R>(
      run: (transaction: typeof tx) => Effect.Effect<A, E, R>
    ) => run(tx),
  };

  return { accounts, captured, db, links };
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
  test("unlinks only the exact account in both records and preserves other synthetic records", async () => {
    const accountId = "account-target";
    const customerId = "customer-target";
    const database = makeFakeDatabase({
      accounts: [
        { dotyposCustomerId: customerId, id: accountId },
        { dotyposCustomerId: "customer-other", id: "account-other" },
      ],
      links: [
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
    expect(database.links).toEqual([
      {
        customerAccountId: accountId,
        dotyposCustomerId: "customer-other-for-account",
      },
      {
        customerAccountId: "account-other",
        dotyposCustomerId: "customer-other",
      },
    ]);
    expect(database.accounts).toEqual([
      { dotyposCustomerId: null, id: accountId },
      { dotyposCustomerId: "customer-other", id: "account-other" },
    ]);
    const dialect = new PgDialect();
    const linkQuery = dialect.sqlToQuery(database.captured.linkWhere!);
    expect(linkQuery.sql).toBe(
      '(("customer_account_links"."customer_account_id" = $1) and ("customer_account_links"."dotypos_customer_id" = $2))'
    );
    expect(linkQuery.params).toEqual([accountId, customerId]);
    const accountQuery = dialect.sqlToQuery(database.captured.accountWhere!);
    expect(accountQuery.sql).toBe(
      '(("customer_accounts"."id" = $1) and ("customer_accounts"."dotypos_customer_id" = $2))'
    );
    expect(accountQuery.params).toEqual([accountId, customerId]);
  });

  test("unlinks an account that only one record names", async () => {
    const accountId = "account-target";
    const customerId = "customer-target";
    const database = makeFakeDatabase({
      accounts: [{ dotyposCustomerId: customerId, id: accountId }],
      links: [],
    });

    const exit = await runRemoveSyntheticAccountLink(
      accountId,
      customerId,
      database
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(database.accounts).toEqual([
      { dotyposCustomerId: null, id: accountId },
    ]);
  });

  test.each([
    {
      name: "missing",
      returnedAccountRows: [],
      returnedLinkRows: [],
    },
    {
      name: "mismatched",
      returnedAccountRows: [],
      returnedLinkRows: [{ customerAccountId: "account-other" }],
    },
    {
      name: "mismatched in the account record",
      returnedAccountRows: [{ customerAccountId: "account-other" }],
      returnedLinkRows: [{ customerAccountId: "account-target" }],
    },
    {
      name: "duplicated",
      returnedAccountRows: [
        { customerAccountId: "account-target" },
        { customerAccountId: "account-target" },
      ],
      returnedLinkRows: [],
    },
  ])(
    "fails closed when the unlinked account is $name",
    async ({ returnedAccountRows, returnedLinkRows }) => {
      const accountId = "account-target";
      const customerId = "customer-target";
      const database = makeFakeDatabase({
        accounts: [{ dotyposCustomerId: customerId, id: accountId }],
        links: [
          { customerAccountId: accountId, dotyposCustomerId: customerId },
        ],
        returnedAccountRows,
        returnedLinkRows,
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
