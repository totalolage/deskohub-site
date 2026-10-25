import "@/shared/polyfills/temporal";

import { describe, test } from "bun:test";
import { type DotyposCustomerId, DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { ReferralFeatureFlagServiceMock } from "@/features/referrals/referral-feature-flag.service.mock";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import {
  makeRecordingWorkspaceDatabase,
  type RecordingWorkspaceDatabase,
} from "@/shared/testing/workspace-recording-database.test-utils";
import { ReferralService } from "./referral.service";

const code = "SYNTHETIC-REFERRAL-CODE";
const identity = {
  accountId: customerAccountIdSchema.make("synthetic-referral-account"),
  dotyposCustomerId: "100000001" as DotyposCustomerId,
};

const collectServiceQueryLogs = <A, E>(
  recording: RecordingWorkspaceDatabase,
  run: (service: ReferralService["Service"]) => Effect.Effect<A, E>
) =>
  collectDatabaseQueryLogs(
    Effect.gen(function* () {
      return yield* run(yield* ReferralService);
    }).pipe(
      Effect.provide(
        ReferralService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              recording.layer,
              ReferralFeatureFlagServiceMock({
                isEnabled: Effect.succeed(true),
              }),
              Layer.mock(WorkspaceDatabaseAdvisoryLock, {}),
              Layer.mock(CustomerAccountLinkRepository, {}),
              Layer.succeed(CustomerAccountResolver, {
                resolve: Effect.succeed(identity),
              }),
              Layer.mock(DotyposService, {})
            )
          )
        )
      )
    )
  );

describe("ReferralService query logging", () => {
  test("censors the code whose kind it looks up", async () => {
    const recording = await makeRecordingWorkspaceDatabase();

    const logs = await collectServiceQueryLogs(recording, (service) =>
      service.lookupCodeKind({ code })
    );

    expectQueryLogsToCensor({ recording, logs, values: [code] });
  });

  test("censors the code whose active referrer it looks up", async () => {
    const recording = await makeRecordingWorkspaceDatabase();

    const logs = await collectServiceQueryLogs(recording, (service) =>
      service.findAvailableCode({ code })
    );

    expectQueryLogsToCensor({ recording, logs, values: [code] });
  });

  test("censors the code a customer accepts", async () => {
    const recording = await makeRecordingWorkspaceDatabase();

    const logs = await collectServiceQueryLogs(recording, (service) =>
      service.acceptReferral({
        code,
        customerAccountId: identity.accountId,
        dotyposCustomerId: identity.dotyposCustomerId,
      })
    );

    expectQueryLogsToCensor({ recording, logs, values: [code] });
  });
});
