import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { CampaignRecipientAnalyticsIdentity } from "./campaign-recipient-analytics-identity";
import {
  analyticsConsentLedgerOf,
  type TestAnalyticsConsent,
} from "./email-campaigns.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const run = crypto.randomUUID().slice(0, 8);
const customerId = (name: string) =>
  DotyposCustomerIdSchema.make(`identity-${run}-${name}`);

describe.skipIf(!testDatabase)(
  "campaign recipient analytics identity on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const { db } = testDatabase;
    const fixtures = workspaceFixtures(db);
    const linkedCustomers: DotyposCustomerId[] = [];

    afterAll(() =>
      testDatabase.pool.query(
        "delete from customer_accounts where dotypos_customer_id = any($1)",
        [linkedCustomers]
      )
    );

    const linkAccount = async (customer: DotyposCustomerId) => {
      linkedCustomers.push(customer);
      return Effect.runPromise(
        fixtures.customerAccount({ linkedCustomer: customer })
      );
    };

    const identitiesOf = (
      customers: readonly DotyposCustomerId[],
      decisions: ReadonlyMap<CustomerAccountId, TestAnalyticsConsent>
    ) =>
      Effect.runPromise(
        Effect.flatMap(CampaignRecipientAnalyticsIdentity, (identity) =>
          identity.forRecipients(customers)
        ).pipe(
          Effect.provide(
            CampaignRecipientAnalyticsIdentity.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  testDatabase.layer,
                  analyticsConsentLedgerOf(
                    (accountId) => decisions.get(accountId) ?? "none"
                  )
                )
              )
            )
          )
        )
      );

    test("names only recipients whose account currently grants analytics", async () => {
      const granted = customerId("granted");
      const withdrawn = customerId("withdrawn");
      const undecided = customerId("undecided");
      const guest = customerId("guest");
      const grantedAccount = await linkAccount(granted);
      const withdrawnAccount = await linkAccount(withdrawn);
      await linkAccount(undecided);

      const identities = await identitiesOf(
        [granted, withdrawn, undecided, guest],
        new Map([
          [grantedAccount, "grant"],
          [withdrawnAccount, "withdraw"],
        ])
      );

      expect([...identities]).toEqual([
        [granted, `workspace-account:${grantedAccount}`],
      ]);
    });

    test("names no one whose consent can't be read", async () => {
      const unreadable = customerId("unreadable");
      const granted = customerId("granted-beside-unreadable");
      const unreadableAccount = await linkAccount(unreadable);
      const grantedAccount = await linkAccount(granted);

      const identities = await identitiesOf(
        [unreadable, granted],
        new Map([
          [unreadableAccount, "unavailable"],
          [grantedAccount, "grant"],
        ])
      );

      expect([...identities]).toEqual([
        [granted, `workspace-account:${grantedAccount}`],
      ]);
    });
  }
);
