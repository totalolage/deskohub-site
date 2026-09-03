import { describe, expect, test } from "bun:test";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import { validE2ERuntimeEnvironment } from "../e2e-env.test-fixture";
import { redact } from "../runtime";
import {
  getAccountE2EConfig,
  makeWorkspaceE2EAccountRecipient,
  makeWorkspaceE2EAccountRunId,
  workspaceE2EAuthCorrelationTags,
} from "./config";

const makeAccountEnvironment = (
  overrides: Readonly<Record<string, string | undefined>> = {}
) =>
  makeWorkspaceE2EEnvironment({
    ...validE2ERuntimeEnvironment,
    WORKSPACE_E2E_RESEND_API_KEY: "re_full-access-retrieval-key",
    ...overrides,
  });

describe("workspace account e2e configuration", () => {
  test("derives the exact immutable preview origin and an opaque run id", () => {
    const config = getAccountE2EConfig(makeAccountEnvironment());

    expect(config.baseUrl).toBe(
      "https://deskohub-workspace-abc123xyz-deskohub.vercel.app"
    );
    expect(config.expectedHost).toBe(
      "deskohub-workspace-abc123xyz-deskohub.vercel.app"
    );
    expect(config.locale).toBe("en-US");
    expect(config.runId).toMatch(/^[a-z0-9]{12}$/);
  });

  test("fails closed before account cases when the retrieval key is absent", () => {
    expect(() =>
      getAccountE2EConfig(
        makeAccountEnvironment({ WORKSPACE_E2E_RESEND_API_KEY: undefined })
      )
    ).toThrow("WORKSPACE_E2E_RESEND_API_KEY is required");
  });

  test("fails closed when the base URL is not an immutable Vercel origin", () => {
    expect(() =>
      getAccountE2EConfig(
        makeAccountEnvironment({
          WORKSPACE_E2E_BASE_URL: "https://deskohub-workspace.example.test",
        })
      )
    ).toThrow("must use a Vercel deployment host");
  });

  test("rejects a mutable branch alias instead of an exact deployment", () => {
    expect(() =>
      getAccountE2EConfig(
        makeAccountEnvironment({
          WORKSPACE_E2E_BASE_URL:
            "https://deskohub-workspace-git-main-deskohub.vercel.app",
        })
      )
    ).toThrow("immutable deployment URL, not a branch alias");
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

  test("registers the retrieval key with the process redactor", () => {
    getAccountE2EConfig(makeAccountEnvironment());

    expect(redact("token re_full-access-retrieval-key tail")).toBe(
      "token [redacted] tail"
    );
  });

  test("derives unique synthetic recipients and registers them for redaction", () => {
    const config = getAccountE2EConfig(makeAccountEnvironment());
    const recipient = makeWorkspaceE2EAccountRecipient(config, "main");
    const other = makeWorkspaceE2EAccountRecipient(config, "active-linking");

    expect(recipient).toBe(`delivered+${config.runId}-main@resend.dev`);
    expect(other).toBe(`delivered+${config.runId}-active-linking@resend.dev`);
    expect(redact(recipient)).toBe("[redacted]");
    expect(redact(other)).toBe("[redacted]");
  });

  test("rejects recipient labels that could encode data beyond the run identity", () => {
    const config = getAccountE2EConfig(makeAccountEnvironment());

    expect(() => makeWorkspaceE2EAccountRecipient(config, "user@mail")).toThrow(
      "must stay opaque"
    );
  });

  test("keeps the run id deterministic per derivation without personal data", () => {
    expect(makeWorkspaceE2EAccountRunId(() => 0)).toBe("aaaaaaaaaaaa");
    expect(makeWorkspaceE2EAccountRunId(() => 0.999)).toBe("999999999999");
  });

  test("exposes the fixed correlation tags shared with the deployed sender", () => {
    expect(workspaceE2EAuthCorrelationTags).toEqual([
      { name: "category", value: "account-magic-link" },
      { name: "surface", value: "workspace" },
    ]);
  });
});
