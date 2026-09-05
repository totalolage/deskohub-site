import { describe, expect, test } from "bun:test";
import { makeE2EEnvironment } from "./e2e-env";
import {
  makeTestE2EEnvironment,
  validE2ERuntimeEnvironment,
} from "./e2e-env.test-fixture";
import {
  isAdminBasicAuthCredentialPair,
  makeWorkspaceE2EAdminCredential,
} from "./admin-basic-auth";
import { redact } from "./runtime";

const syntheticPair = "e2e-admin:s3cret-value-with:colons";

describe("Workspace E2E admin Basic auth credential", () => {
  test("stays optional in the runner environment schema", () => {
    expect(
      makeE2EEnvironment(validE2ERuntimeEnvironment)
        .WORKSPACE_E2E_ADMIN_BASIC_AUTH
    ).toBeUndefined();
  });

  test("accepts a username:password pair", () => {
    expect(
      makeTestE2EEnvironment({
        WORKSPACE_E2E_ADMIN_BASIC_AUTH: syntheticPair,
      }).WORKSPACE_E2E_ADMIN_BASIC_AUTH
    ).toBe(syntheticPair);
  });

  test.each([
    { WORKSPACE_E2E_ADMIN_BASIC_AUTH: "just-a-password" },
    { WORKSPACE_E2E_ADMIN_BASIC_AUTH: ":secret" },
    { WORKSPACE_E2E_ADMIN_BASIC_AUTH: "admin:" },
    { WORKSPACE_E2E_ADMIN_BASIC_AUTH: " admin:secret" },
    { WORKSPACE_E2E_ADMIN_BASIC_AUTH: "admin :secret" },
    { WORKSPACE_E2E_ADMIN_BASIC_AUTH: `${"a".repeat(81)}:secret` },
  ])("rejects an invalid credential pair", (runtimeEnvironment) => {
    expect(() =>
      makeE2EEnvironment({
        ...validE2ERuntimeEnvironment,
        ...runtimeEnvironment,
      })
    ).toThrow("Invalid workspace E2E environment variables.");
  });

  test("describes the pair shape", () => {
    expect(isAdminBasicAuthCredentialPair(syntheticPair)).toBe(true);
    expect(isAdminBasicAuthCredentialPair("just-a-password")).toBe(false);
  });

  test("fails closed with provisioning guidance when the credential is absent", () => {
    expect(() => makeWorkspaceE2EAdminCredential(undefined)).toThrow(
      "Provision the workspace-checkout-e2e GitHub Actions environment secret WORKSPACE_E2E_ADMIN_BASIC_AUTH"
    );
    expect(() => makeWorkspaceE2EAdminCredential(undefined)).toThrow(
      "ADMIN_BASIC_AUTH_CREDENTIALS"
    );
    expect(() => makeWorkspaceE2EAdminCredential("just-a-password")).toThrow(
      "WORKSPACE_E2E_ADMIN_BASIC_AUTH must be a username:password pair"
    );
  });

  test("splits at the first colon and keeps the password intact", () => {
    const credential = makeWorkspaceE2EAdminCredential(syntheticPair);

    expect(credential.username).toBe("e2e-admin");
    expect(credential.password).toBe("s3cret-value-with:colons");
  });

  test("redacts the pair and the password at the process boundary", () => {
    const credential = makeWorkspaceE2EAdminCredential(
      `e2e-redaction-check:${syntheticPair}`
    );

    expect(
      redact(`leaked ${credential.password} and ${syntheticPair}`)
    ).not.toContain(credential.password);
  });
});
