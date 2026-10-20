import { describe, expect, test } from "bun:test";
import type { CommandResult } from "./shared/command";
import { describeSourceMapUploadFailure } from "./source-map-upload-failure";

const credential = "phx_TEST_ONLY_not_a_secret";
const apiUrl =
  "https://eu.posthog.example/api/environments/987654/error_tracking/releases";
const presignedUrl =
  "https://posthog-symbols.s3.example/chunk?X-Amz-Credential=AKIA_TEST_ONLY_KEY&X-Amz-Signature=TEST_ONLY_SIGNATURE";

/** Everything the CLI may echo that must never reach the build log. */
const sensitiveFragments = [
  credential,
  `Bearer ${credential}`,
  encodeURIComponent(credential),
  "TEST_ONLY",
  "posthog.example",
  "987654",
  "s3.example",
  "X-Amz",
  "Response text",
];

const failedRun = (
  stderr: string,
  overrides: Partial<CommandResult> = {}
): CommandResult => ({
  exitCode: 1,
  signalCode: null,
  stdout: `INFO posthog_cli: Using credential ${credential} for ${apiUrl}\n`,
  stderr,
  timedOut: false,
  ...overrides,
});

describe("describeSourceMapUploadFailure", () => {
  test.each([
    {
      name: "an S3 chunk upload PostHog's storage rejected",
      stderr: `ERROR posthog_cli::utils: Request failed: Response { url: "${presignedUrl}", status: 503, headers: {"authorization": "Bearer ${credential}"} }
ERROR posthog_cli::utils: Response text: <Error>SlowDown ${credential}</Error>
Oops! Failed to upload chunk

Caused by:
    0: Request failed`,
      kind: "transient",
      summary:
        "posthog-cli exited with code 1 while uploading a chunk: HTTP 503",
    },
    {
      name: "a release the API couldn't create behind a bad gateway",
      stderr: `Oops! Failed to create release

Caused by:
    0: API error: status='502' url='${apiUrl}' message='<html>Bad gateway for ${credential}</html>'`,
      kind: "transient",
      summary:
        "posthog-cli exited with code 1 while creating the release: HTTP 502",
    },
    {
      name: "a rate-limited upload start",
      stderr: `Oops! Failed to start upload

Caused by:
    0: HTTP status client error (429 Too Many Requests) for url (${apiUrl})`,
      kind: "transient",
      summary:
        "posthog-cli exited with code 1 while starting the upload: HTTP 429",
    },
    {
      name: "a dropped connection",
      stderr: `Oops! Failed to create release

Caused by:
    0: Request error: error sending request for url (${apiUrl}?token=${credential})
    1: client error (Connect)
    2: connection reset by peer`,
      kind: "transient",
      summary:
        "posthog-cli exited with code 1 while creating the release: connection failed, request not sent",
    },
    {
      name: "a throttled request reported as a PostHog error type",
      stderr: `Oops! Failed to finalize symbol upload; maps were not attached

Caused by:
    0: API error: error='throttled_error' code='throttled' details='Slow down ${credential}'`,
      kind: "transient",
      summary:
        "posthog-cli exited with code 1 while finalizing the upload: PostHog throttled_error",
    },
    {
      name: "a rejected personal API key",
      stderr: `Oops! Failed to create release

Caused by:
    0: API error: error='authentication_error' code='authentication_failed' details='Key ${credential} is invalid'`,
      kind: "permanent",
      summary:
        "posthog-cli exited with code 1 while creating the release: PostHog authentication_error",
    },
    {
      name: "a forbidden project",
      stderr: `Oops! Failed to create release

Caused by:
    0: API error: status='403' url='${apiUrl}' message='denied'`,
      kind: "permanent",
      summary:
        "posthog-cli exited with code 1 while creating the release: HTTP 403",
    },
    {
      name: "a malformed key",
      stderr: `Oops! Invalid Personal API key: Token looks wrong, must start with 'phx_'`,
      kind: "permanent",
      summary: "posthog-cli exited with code 1: invalid personal API key",
    },
    {
      name: "a build without source maps",
      stderr: "Oops! no source files found",
      kind: "permanent",
      summary: "posthog-cli exited with code 1: no source files found",
    },
    {
      name: "an S3 chunk upload whose body repeats its status",
      stderr: `ERROR posthog_cli::utils: Request failed: Response { url: "${presignedUrl}", status: 503 }
ERROR posthog_cli::utils: Response text: Request failed: Response { status: 503 }
Oops! Failed to upload chunk

Caused by:
    0: Request failed`,
      kind: "transient",
      summary:
        "posthog-cli exited with code 1 while uploading a chunk: HTTP 503",
    },
    {
      name: "a forbidden S3 chunk upload whose body names a transient status",
      stderr: `ERROR posthog_cli::utils: Request failed: Response { url: "${presignedUrl}", status: 403 }
ERROR posthog_cli::utils: Response text: Request failed: Response { status: 503 }
Oops! Failed to upload chunk

Caused by:
    0: Request failed`,
      kind: "unknown",
      summary:
        "posthog-cli exited with code 1 while uploading a chunk: conflicting HTTP statuses",
    },
    {
      name: "a permanent final error after a retried transient one",
      stderr: `ERROR posthog_cli::utils: Request failed: Response { url: "${presignedUrl}", status: 503 }
Oops! Release ID mismatch: symbol sets already exist with different release IDs`,
      kind: "permanent",
      summary: "posthog-cli exited with code 1: release ID mismatch",
    },
    {
      name: "an unrecognised final error after a retried transient one",
      stderr: `WARN posthog_cli::api::symbol_sets: Operation failed: ApiError(503, "${apiUrl}", "busy")
ERROR posthog_cli::utils: Request failed: Response { url: "${presignedUrl}", status: 503 }
ERROR posthog_cli::utils: Response text: connection reset, timed out
Oops! Something new`,
      kind: "unknown",
      summary:
        "posthog-cli exited with code 1: no recognised error in its output",
    },
    {
      name: "a release lookup that couldn't reach PostHog (real CLI 0.16.2 output)",
      stderr: `2026-10-20T19:21:03.552715Z  WARN posthog_cli::api::releases: failed to get release from hash: Request error: error sending request for url (${apiUrl}/hash/8893c0f5)
Oops! Request error: error sending request for url (${apiUrl}/hash/8893c0f5)`,
      kind: "transient",
      summary:
        "posthog-cli exited with code 1 while looking up the release: request not sent",
    },
    {
      name: "an API error whose body mimics transient evidence",
      stderr: `Oops! Failed to create release

Caused by:
    0: API error: status='401' url='${apiUrl}' message='status: 503 HTTP status server error (502) timed out
  connection reset error='server_error' code='x'
    1: dns error'`,
      kind: "permanent",
      summary:
        "posthog-cli exited with code 1 while creating the release: HTTP 401",
    },
    {
      name: "an unrecognised API error whose details mimic a timeout",
      stderr: `Oops! Failed to create release

Caused by:
    0: API error: error='surprise' code='x' details='upstream timed out, status='503''`,
      kind: "unknown",
      summary:
        "posthog-cli exited with code 1 while creating the release: unrecognised PostHog error type",
    },
    {
      name: "a logged S3 body that mimics a final error",
      stderr: `ERROR posthog_cli::utils: Request failed: Response { url: "${presignedUrl}", status: 403 }
ERROR posthog_cli::utils: Response text: denied
Oops! API error: status='503' url='${apiUrl}' message='busy'
Oops! Failed to upload chunk

Caused by:
    0: Request failed`,
      kind: "unknown",
      summary:
        "posthog-cli exited with code 1 while uploading a chunk: several final errors in its output",
    },
    ...["constructor", "__proto__"].map((type) => ({
      name: `an API error type named ${type}`,
      stderr: `Oops! API error: error='${type}' code='x' details='y'`,
      kind: "unknown",
      summary:
        "posthog-cli exited with code 1: unrecognised PostHog error type",
    })),
    {
      name: "a PostHog error type outside the known vocabulary",
      stderr: `Oops! API error: error='surprise_${credential.toLowerCase()}' code='x' details='y'`,
      kind: "unknown",
      summary:
        "posthog-cli exited with code 1: unrecognised PostHog error type",
    },
    {
      name: "unrecognised output",
      stderr: `Oops! Something new happened near ${presignedUrl} with ${credential}`,
      kind: "unknown",
      summary:
        "posthog-cli exited with code 1: no recognised error in its output",
    },
  ])(
    "describes $name without quoting the output",
    ({ stderr, kind, summary }) => {
      const failure = describeSourceMapUploadFailure(failedRun(stderr));

      expect(failure).toEqual({ kind, summary });
      for (const fragment of sensitiveFragments) {
        expect(failure.summary).not.toContain(fragment);
      }
    }
  );

  test.each([
    {
      name: "a timed-out run",
      overrides: { exitCode: null, signalCode: "SIGKILL", timedOut: true },
      summary:
        "posthog-cli timed out while uploading a chunk: no recognised error in its output",
    },
    {
      name: "a killed run",
      overrides: { exitCode: null, signalCode: "SIGKILL" },
      summary:
        "posthog-cli was ended by SIGKILL while uploading a chunk: no recognised error in its output",
    },
  ])(
    "treats $name as interrupted even after a transient error",
    ({ overrides, summary }) => {
      expect(
        describeSourceMapUploadFailure(
          failedRun(
            `ERROR posthog_cli::utils: Request failed: Response { status: 503 }\nWARN Failed to upload chunk, retrying`,
            overrides
          )
        )
      ).toEqual({ kind: "interrupted", summary });
    }
  );
});
