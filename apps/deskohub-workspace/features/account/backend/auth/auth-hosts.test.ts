import { describe, expect, test } from "bun:test";
import {
  type BetterAuthHostEnvironment,
  resolveBetterAuthAllowedHosts,
  resolveCustomerMcpResource,
  resolvePasskeyRelyingParty,
} from "./auth-hosts";

describe("Better Auth allowed hosts resolution", () => {
  const invalidMessage = (
    environment: Parameters<typeof resolveBetterAuthAllowedHosts>[0]
  ) => {
    const result = resolveBetterAuthAllowedHosts(environment);
    return result.kind === "invalid" ? result.message : "valid";
  };

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

  test("rejects one-character wildcard host patterns instead of trusting them", () => {
    expect(
      invalidMessage({
        vercelEnv: "preview",
        customerFacingHost: "workspace.deskohub.c?",
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
        deploymentUrl: "deskohub-workspace-abc?23.vercel.app",
        branchUrl: undefined,
      })
    ).toBe("Wildcard hosts are not allowed for Better Auth.");
  });
});

describe("passkey relying party resolution", () => {
  const vercelHosts = {
    customerFacingHost: "workspace.deskohub.cz",
    projectProductionUrl: "deskohub-workspace.vercel.app",
    deploymentUrl: "deskohub-workspace-abc123.vercel.app",
    branchUrl: "deskohub-git-feature-git-team.vercel.app",
  } as const;

  const relyingParty = (environment: BetterAuthHostEnvironment) => {
    const result = resolvePasskeyRelyingParty(environment);
    return result.kind === "valid" ? result.relyingParty : result.message;
  };

  test("binds production to the canonical customer-facing host", () => {
    expect(relyingParty({ vercelEnv: "production", ...vercelHosts })).toEqual({
      rpID: "workspace.deskohub.cz",
      origins: ["https://workspace.deskohub.cz"],
    });
  });

  test("normalizes the canonical host before deriving the RP ID", () => {
    expect(
      relyingParty({
        vercelEnv: "production",
        ...vercelHosts,
        customerFacingHost: "https://Workspace.Deskohub.cz/",
      })
    ).toEqual({
      rpID: "workspace.deskohub.cz",
      origins: ["https://workspace.deskohub.cz"],
    });
  });

  test("binds a preview to its immutable deployment host, not the branch alias", () => {
    expect(relyingParty({ vercelEnv: "preview", ...vercelHosts })).toEqual({
      rpID: "deskohub-workspace-abc123.vercel.app",
      origins: ["https://deskohub-workspace-abc123.vercel.app"],
    });
  });

  test("fails closed on a preview without a deployment host", () => {
    expect(
      relyingParty({
        vercelEnv: "preview",
        ...vercelHosts,
        deploymentUrl: undefined,
      })
    ).toBe("The preview deployment host is not configured for passkeys.");
  });

  test("uses localhost over HTTP on the allowed local ports in development", () => {
    expect(
      relyingParty({
        vercelEnv: "development",
        customerFacingHost: "workspace.deskohub.cz",
        projectProductionUrl: undefined,
        deploymentUrl: undefined,
        branchUrl: undefined,
      })
    ).toEqual({ rpID: "localhost", origins: ["http://localhost:3000"] });
  });

  test("fails closed with the allowed-hosts errors", () => {
    expect(
      relyingParty({
        vercelEnv: "production",
        ...vercelHosts,
        customerFacingHost: undefined,
      })
    ).toBe("The canonical production host is not configured for Better Auth.");
    expect(
      relyingParty({
        vercelEnv: "preview",
        ...vercelHosts,
        deploymentUrl: "*.vercel.app",
      })
    ).toBe("Wildcard hosts are not allowed for Better Auth.");
  });
});

describe("customer MCP resource resolution", () => {
  const vercelHosts = {
    customerFacingHost: "workspace.deskohub.cz",
    projectProductionUrl: "deskohub-workspace.vercel.app",
    deploymentUrl: "deskohub-workspace-abc123.vercel.app",
    branchUrl: "deskohub-git-feature-git-team.vercel.app",
  } as const;

  const resource = (environment: BetterAuthHostEnvironment) => {
    const result = resolveCustomerMcpResource(environment, "/api/mcp");
    return result.kind === "valid" ? result.resource : result.message;
  };

  test("binds production to the canonical customer-facing host", () => {
    expect(
      resource({
        vercelEnv: "production",
        ...vercelHosts,
        customerFacingHost: "https://Workspace.Deskohub.cz/",
      })
    ).toBe("https://workspace.deskohub.cz/api/mcp");
  });

  test("binds a preview to its immutable deployment host, not the branch alias", () => {
    expect(resource({ vercelEnv: "preview", ...vercelHosts })).toBe(
      "https://deskohub-workspace-abc123.vercel.app/api/mcp"
    );
  });

  test("fails closed on a preview without a deployment host", () => {
    expect(
      resource({
        vercelEnv: "preview",
        ...vercelHosts,
        deploymentUrl: undefined,
      })
    ).toBe("The preview deployment host is not configured for the MCP server.");
  });

  test("uses localhost over HTTP in development", () => {
    expect(
      resource({
        vercelEnv: "development",
        customerFacingHost: "workspace.deskohub.cz",
        projectProductionUrl: undefined,
        deploymentUrl: undefined,
        branchUrl: undefined,
      })
    ).toBe("http://localhost:3000/api/mcp");
  });

  test("fails closed with the allowed-hosts errors", () => {
    expect(
      resource({
        vercelEnv: "preview",
        ...vercelHosts,
        deploymentUrl: "*.vercel.app",
      })
    ).toBe("Wildcard hosts are not allowed for Better Auth.");
  });
});
