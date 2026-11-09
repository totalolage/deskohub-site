import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import { validE2ERuntimeEnvironment } from "../e2e-env.test-fixture";
import { redact } from "../redaction";
import {
  type WorkspaceE2ERunId,
  workspaceE2ERunIdSchema,
} from "../run-identifiers";
import {
  getAccountE2EConfig,
  makeWorkspaceE2EAccountRecipient,
  makeWorkspaceE2EAccountRecipientForRunId,
  workspaceE2EAccountMainRecipientLabel,
  workspaceE2EReferralOwnerRecipientLabel,
} from "./config";

const runId = (value: string): WorkspaceE2ERunId =>
  Schema.decodeUnknownSync(workspaceE2ERunIdSchema)(value);

const makeAccountEnvironment = (
  overrides: Readonly<Record<string, string | undefined>> = {}
) =>
  makeWorkspaceE2EEnvironment({
    ...validE2ERuntimeEnvironment,
    WORKSPACE_E2E_VERCEL_PROJECT: "workspace-preview-project",
    WORKSPACE_E2E_VERCEL_TOKEN: "vercel-log-read-token",
    ...overrides,
  });

describe("workspace account e2e configuration", () => {
  test("fails closed before account cases when the Vercel log-read token is absent", () => {
    expect(() =>
      getAccountE2EConfig(
        makeAccountEnvironment({ WORKSPACE_E2E_VERCEL_TOKEN: undefined })
      )
    ).toThrow("WORKSPACE_E2E_VERCEL_TOKEN is required");
  });

  test("fails closed before account cases when the Vercel project id is absent", () => {
    expect(() =>
      getAccountE2EConfig(
        makeAccountEnvironment({ WORKSPACE_E2E_VERCEL_PROJECT: undefined })
      )
    ).toThrow("WORKSPACE_E2E_VERCEL_PROJECT is required");
  });

  test("registers the protection bypass secret with the process redactor", () => {
    getAccountE2EConfig(
      makeAccountEnvironment({
        VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-secret-value",
      })
    );

    expect(redact("probe bypass-secret-value tail")).toBe(
      "probe [redacted] tail"
    );
  });

  test("registers the Vercel log-read token with the process redactor", () => {
    getAccountE2EConfig(makeAccountEnvironment());

    expect(redact("token vercel-log-read-token tail")).toBe(
      "token [redacted] tail"
    );
  });

  test("derives unique synthetic recipients and registers them for redaction", () => {
    const config = getAccountE2EConfig(
      makeAccountEnvironment(),
      runId("1234567890-2")
    );
    const recipient = makeWorkspaceE2EAccountRecipient(
      config,
      workspaceE2EAccountMainRecipientLabel
    );
    const other = makeWorkspaceE2EAccountRecipient(config, "active-linking");
    const referralOwner = makeWorkspaceE2EAccountRecipient(
      config,
      workspaceE2EReferralOwnerRecipientLabel
    );

    expect(recipient).toBe(testEmailAddress(`delivered+${config.runId}-main`));
    expect(other).toBe(
      testEmailAddress(`delivered+${config.runId}-active-linking`)
    );
    expect(redact(recipient)).toBe("[redacted]");
    expect(redact(other)).toBe("[redacted]");
    expect(referralOwner).toBe(
      testEmailAddress(`delivered+${config.runId}-referral-owner`)
    );
    expect(redact(referralOwner)).toBe("[redacted]");
  });

  test("rejects run ids that could encode data beyond the run identity", () => {
    expect(() =>
      makeWorkspaceE2EAccountRecipientForRunId(
        runId("user@mail"),
        workspaceE2EAccountMainRecipientLabel
      )
    ).toThrow("must stay opaque");
    expect(() =>
      makeWorkspaceE2EAccountRecipientForRunId(
        runId("two words"),
        workspaceE2EAccountMainRecipientLabel
      )
    ).toThrow("must stay opaque");
  });
});
