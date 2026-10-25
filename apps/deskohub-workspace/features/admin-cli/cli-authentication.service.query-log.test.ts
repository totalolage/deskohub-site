import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { testEmailAddress } from "@deskohub/test-email";
import {
  CliAuthenticationCode,
  CliAuthenticationVerifier,
  CliGrantToken,
} from "@deskohub/workspace-admin-api";
import { Crypto, Effect, Layer } from "effect";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import {
  collectDatabaseQueryLogs,
  expectQueryLogsToCensor,
} from "@/shared/testing/workspace-database-query-log.test-utils";
import {
  makeRecordingWorkspaceDatabase,
  type RecordingWorkspaceDatabase,
} from "@/shared/testing/workspace-recording-database.test-utils";
import { CliAuthentication } from "./cli-authentication.service";
import { cliSessionLifetimeSchema } from "./contracts";

const syntheticSecret = (fill: number) =>
  Buffer.alloc(32, fill).toString("base64url");

// Every secret the service mints is this value, so the test knows the grant
// token an approval issues.
const mintedSecret = syntheticSecret(7);
const fixedCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) =>
    Effect.succeed(new Uint8Array(createHash("sha256").update(data).digest())),
});

const approver = {
  accountId: customerAccountIdSchema.make("synthetic-cli-approver"),
  email: testEmailAddress("cli-approver"),
};
const code = CliAuthenticationCode.make(syntheticSecret(1));
const verifier = CliAuthenticationVerifier.make(syntheticSecret(2));
const submittedGrantToken = CliGrantToken.make(syntheticSecret(3));

const past = "2020-01-01T00:00:00Z";
const future = "2099-01-01T00:00:00Z";

/** A `cli_authentication_requests` row in column order. */
const requestRow = (approved: boolean) => [
  "synthetic-request-id",
  syntheticSecret(4), // code_hash
  syntheticSecret(5), // challenge
  "Synthetic CLI",
  "1.0.0",
  "development",
  past, // created_at
  future, // expires_at
  approved ? past : null, // approved_at
  null, // approved_by
  approved ? approver.accountId : null,
  approved ? approver.email : null,
  approved ? submittedGrantToken : null,
  approved ? future : null, // grant_expires_at
  null, // session_expires_at
  null, // consumed_at
  null, // session_id
];
const heldGrantRow = [approver.accountId];

const collectServiceQueryLogs = <A, E>(
  recording: RecordingWorkspaceDatabase,
  run: (service: CliAuthentication["Service"]) => Effect.Effect<A, E>
) =>
  collectDatabaseQueryLogs(
    Effect.gen(function* () {
      return yield* run(yield* CliAuthentication);
    }).pipe(
      Effect.provide(
        CliAuthentication.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              recording.layer,
              AccountRoleGrants.Default.pipe(Layer.provide(recording.layer)),
              Layer.succeed(Crypto.Crypto, fixedCrypto)
            )
          )
        )
      )
    )
  );

describe("CliAuthentication query logging", () => {
  test("censors the approver's email and the grant token an approval issues", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      [[...requestRow(false), null, null]], // the pending request
      [heldGrantRow],
      [requestRow(true)], // the approval update
    ]);

    let approvedState: string | undefined;

    const logs = await collectServiceQueryLogs(recording, (service) =>
      service
        .approve({
          code,
          approvedBy: approver,
          sessionLifetime: cliSessionLifetimeSchema.cases.Never.make({}),
        })
        .pipe(
          Effect.tap(({ state }) => Effect.sync(() => (approvedState = state)))
        )
    );

    expect(approvedState).toBe("approved");
    expectQueryLogsToCensor({
      recording,
      logs,
      values: [approver.email, mintedSecret],
    });
  });

  test("censors the submitted grant token and the session's approver email in an exchange", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([
      [requestRow(true)], // the approved request
      [heldGrantRow],
      [], // the session insert
      [requestRow(true)], // the consuming update
    ]);

    let exchanged = false;

    const logs = await collectServiceQueryLogs(recording, (service) =>
      service
        .exchange({ code, verifier, grantToken: submittedGrantToken })
        .pipe(Effect.tap(() => Effect.sync(() => (exchanged = true))))
    );

    // Completing means the consuming update ran too, so both statements that
    // bind the grant token are in the log.
    expect(exchanged).toBe(true);
    expect(
      recording.statements.filter(({ params }) =>
        params.includes(submittedGrantToken)
      )
    ).toHaveLength(2);
    expectQueryLogsToCensor({
      recording,
      logs,
      values: [submittedGrantToken, approver.email],
    });
  });
});
