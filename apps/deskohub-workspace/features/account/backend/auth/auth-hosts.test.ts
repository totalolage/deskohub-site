import { describe, expect, test } from "bun:test";
import { resolveBetterAuthAllowedHosts } from "./auth-hosts";

describe("Better Auth allowed hosts resolution", () => {
  const invalidMessage = (
    environment: Parameters<typeof resolveBetterAuthAllowedHosts>[0]
  ) => {
    const result = resolveBetterAuthAllowedHosts(environment);
    return result.kind === "invalid" ? result.message : "valid";
  };

  test("allows the customer-facing production host ahead of the exact deployment hosts in production", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "production",
      customerFacingHost: "workspace.deskohub.cz",
      projectProductionUrl: "deskohub-workspace.vercel.app",
      deploymentUrl: "deskohub-workspace-abc123.vercel.app",
      branchUrl: undefined,
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toEqual([
        "workspace.deskohub.cz",
        "deskohub-workspace.vercel.app",
        "deskohub-workspace-abc123.vercel.app",
      ]);
    }
  });

  test("allows the branch deployment host on previews", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "preview",
      customerFacingHost: "workspace.deskohub.cz",
      projectProductionUrl: "deskohub-workspace.vercel.app",
      deploymentUrl: "deskohub-workspace-abc123.vercel.app",
      branchUrl: "deskohub-git-feature-git-team.vercel.app",
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toEqual([
        "workspace.deskohub.cz",
        "deskohub-workspace.vercel.app",
        "deskohub-workspace-abc123.vercel.app",
        "deskohub-git-feature-git-team.vercel.app",
      ]);
    }
  });

  test("allows localhost only during local development", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "development",
      customerFacingHost: "workspace.deskohub.cz",
      projectProductionUrl: undefined,
      deploymentUrl: undefined,
      branchUrl: undefined,
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toEqual(["workspace.deskohub.cz", "localhost:3000"]);
    }
  });

  test("normalizes scheme, path, case, and trailing slashes", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "preview",
      customerFacingHost: "https://Workspace.Deskohub.cz/",
      projectProductionUrl: "https://deskohub-workspace.vercel.app/",
      deploymentUrl: "https://deskohub-workspace-abc123.vercel.app/",
      branchUrl: undefined,
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toEqual([
        "workspace.deskohub.cz",
        "deskohub-workspace.vercel.app",
        "deskohub-workspace-abc123.vercel.app",
      ]);
    }
  });

  test("keeps an explicit port", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "development",
      customerFacingHost: "localhost:3000",
      projectProductionUrl: undefined,
      deploymentUrl: undefined,
      branchUrl: undefined,
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toEqual(["localhost:3000"]);
    }
  });

  test("deduplicates the customer-facing host repeated as a Vercel host", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "production",
      customerFacingHost: "workspace.deskohub.cz",
      projectProductionUrl: "workspace.deskohub.cz",
      deploymentUrl: undefined,
      branchUrl: undefined,
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toEqual(["workspace.deskohub.cz"]);
    }
  });

  test("fails closed without the customer-facing production host", () => {
    expect(
      invalidMessage({
        vercelEnv: "production",
        customerFacingHost: undefined,
        projectProductionUrl: "deskohub-workspace.vercel.app",
        deploymentUrl: undefined,
        branchUrl: undefined,
      })
    ).toBe("The canonical production host is not configured for Better Auth.");
  });

  test("rejects wildcard host patterns instead of trusting them", () => {
    expect(
      invalidMessage({
        vercelEnv: "preview",
        customerFacingHost: "*.deskohub.cz",
        projectProductionUrl: undefined,
        deploymentUrl: undefined,
        branchUrl: undefined,
      })
    ).toBe("Wildcard hosts are not allowed for Better Auth.");

    expect(
      invalidMessage({
        vercelEnv: "preview",
        customerFacingHost: "workspace.deskohub.cz",
        projectProductionUrl: undefined,
        deploymentUrl: "tenant-*.vercel.app",
        branchUrl: undefined,
      })
    ).toBe("Wildcard hosts are not allowed for Better Auth.");
  });
});
