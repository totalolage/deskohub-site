import { describe, expect, test } from "bun:test";
import { resolveBetterAuthAllowedHosts } from "./auth-hosts";

describe("Better Auth allowed hosts resolution", () => {
  const invalidMessage = (
    environment: Parameters<typeof resolveBetterAuthAllowedHosts>[0]
  ) => {
    const result = resolveBetterAuthAllowedHosts(environment);
    return result.kind === "invalid" ? result.message : "valid";
  };

  test("allows only the canonical production and deployment hosts in production", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "production",
      productionUrl: "workspace.deskohub.cz",
      commitUrl: "deskohub-workspace-abc123.vercel.app",
      branchUrl: undefined,
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toEqual([
        "workspace.deskohub.cz",
        "deskohub-workspace-abc123.vercel.app",
      ]);
    }
  });

  test("allows the branch deployment host on previews", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "preview",
      productionUrl: "workspace.deskohub.cz",
      commitUrl: "deskohub-workspace-abc123.vercel.app",
      branchUrl: "deskohub-git-feature-git-team.vercel.app",
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toEqual([
        "workspace.deskohub.cz",
        "deskohub-workspace-abc123.vercel.app",
        "deskohub-git-feature-git-team.vercel.app",
      ]);
    }
  });

  test("allows localhost only during local development", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "development",
      productionUrl: "workspace.deskohub.cz",
      commitUrl: undefined,
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
      productionUrl: "https://Workspace.Deskohub.cz/",
      commitUrl: "https://deskohub-workspace-abc123.vercel.app/",
      branchUrl: undefined,
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toEqual([
        "workspace.deskohub.cz",
        "deskohub-workspace-abc123.vercel.app",
      ]);
    }
  });

  test("keeps an explicit port", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "development",
      productionUrl: "localhost:3000",
      commitUrl: undefined,
      branchUrl: undefined,
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toContain("localhost:3000");
    }
  });

  test("deduplicates repeated hosts", () => {
    const result = resolveBetterAuthAllowedHosts({
      vercelEnv: "production",
      productionUrl: "workspace.deskohub.cz",
      commitUrl: "workspace.deskohub.cz",
      branchUrl: undefined,
    });

    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.hosts).toEqual(["workspace.deskohub.cz"]);
    }
  });

  test("fails closed without a production host", () => {
    expect(
      invalidMessage({
        vercelEnv: "production",
        productionUrl: undefined,
        commitUrl: undefined,
        branchUrl: undefined,
      })
    ).toBe("The canonical production host is not configured for Better Auth.");
  });

  test("rejects wildcard host patterns instead of trusting them", () => {
    expect(
      invalidMessage({
        vercelEnv: "preview",
        productionUrl: "*.vercel.app",
        commitUrl: undefined,
        branchUrl: undefined,
      })
    ).toBe("Wildcard hosts are not allowed for Better Auth.");

    expect(
      invalidMessage({
        vercelEnv: "preview",
        productionUrl: "workspace.deskohub.cz",
        commitUrl: "tenant-*.vercel.app",
        branchUrl: undefined,
      })
    ).toBe("Wildcard hosts are not allowed for Better Auth.");
  });
});
