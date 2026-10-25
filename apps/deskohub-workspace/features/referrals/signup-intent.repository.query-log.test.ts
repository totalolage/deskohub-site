import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { parseReferralCode } from "./client";
import { ReferralSignupIntentRepository } from "./signup-intent.repository";

describe("ReferralSignupIntentRepository query logging", () => {
  test("censors the referral code whose target it looks up", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    const code = parseReferralCode("SYNTHETIC-SIGNUP-CODE");
    expect(code).toBeDefined();

    const logs = await collectDatabaseQueryLogs(
      Effect.gen(function* () {
        const repository = yield* ReferralSignupIntentRepository;
        yield* repository.findCodeTarget(code!);
      }).pipe(
        Effect.provide(
          ReferralSignupIntentRepository.Default.pipe(
            Layer.provide(recording.layer)
          )
        )
      )
    );

    expectQueryLogsToCensor({ recording, logs, values: [code!] });
  });
});
