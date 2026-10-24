import "@/shared/polyfills/temporal";

import { describe, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { findActiveCustomerAccountByEmail } from "./customer-account-by-email";

describe("findActiveCustomerAccountByEmail query logging", () => {
  test("censors the login email it looks up", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const email = testEmailAddress("account-lookup");

    const logs = await collectDatabaseQueryLogs(
      findActiveCustomerAccountByEmail(email).pipe(
        Effect.provide(recording.layer)
      )
    );

    expectQueryLogsToCensor({ recording, logs, values: [email] });
  });
});
