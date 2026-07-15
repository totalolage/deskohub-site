import { describe, expect, test } from "bun:test";
import {
  decideIgnoreBuild,
  getGitDiffArgs,
  isNonRuntimePath,
  parseChangedPaths,
} from "./vercel-ignore-build";

const validPreview = {
  previousSha: "0123456789abcdef0123456789abcdef01234567",
  vercelEnvironment: "preview",
} as const;

describe("isNonRuntimePath", () => {
  test("allows documentation and repository metadata", () => {
    expect(
      [
        "AGENTS.md",
        "README.md",
        "packages/posthog/README.md",
        "docs/CACHING_STRATEGY.md",
        "apps/deskohub-workspace/docs/checkout-lifecycle.md",
      ].every(isNonRuntimePath)
    ).toBeTrue();
  });

  test("allows CI configuration, tests, and the Workspace E2E harness", () => {
    expect(
      [
        ".github/workflows/workspace-tests.yml",
        "packages/dotypos/src/backend/service.test.ts",
        "apps/deskohub-workspace/features/contact/form.spec.tsx",
        "apps/deskohub-workspace/e2e/cases/checkout.ts",
        "apps/deskohub-workspace/scripts/workspace-e2e.ts",
        "apps/deskohub-workspace/tsconfig.test.json",
      ].every(isNonRuntimePath)
    ).toBeTrue();
  });

  test("rejects runtime and deployment paths", () => {
    expect(
      [
        "apps/deskohub-workspace/app/page.tsx",
        "apps/deskohub-workspace/app/[locale]/(testing-only)/layout.tsx",
        "apps/deskohub-workspace/db/migrations/0001_example.sql",
        "apps/deskohub-workspace/scripts/production-build.ts",
        "apps/deskohub-workspace/turbo.json",
        "apps/deskohub-workspace/vercel.json",
        "packages/dotypos/src/backend/service.ts",
        ".vercelignore",
        "bun.lock",
        "package.json",
        "turbo.json",
      ].every((path) => !isNonRuntimePath(path))
    ).toBeTrue();
  });
});

describe("decideIgnoreBuild", () => {
  test("skips an all-documentation preview", () => {
    expect(
      decideIgnoreBuild({
        ...validPreview,
        changedPaths: [
          "README.md",
          "docs/CACHING_STRATEGY.md",
          "packages/dotypos/docs/OPENAPI_INTEGRATION.md",
        ],
      }).exitCode
    ).toBe(0);
  });

  test("skips mixed documentation, tests, and CI changes", () => {
    expect(
      decideIgnoreBuild({
        ...validPreview,
        changedPaths: [
          ".github/workflows/workspace-tests.yml",
          "apps/deskohub-workspace/docs/checkout-lifecycle.md",
          "apps/deskohub-workspace/features/contact/actions/contact.test.ts",
        ],
      }).exitCode
    ).toBe(0);
  });

  test("skips an E2E-only Git preview", () => {
    expect(
      decideIgnoreBuild({
        ...validPreview,
        changedPaths: [
          "apps/deskohub-workspace/e2e/cases/checkout.ts",
          "apps/deskohub-workspace/scripts/workspace-e2e.ts",
        ],
      }).exitCode
    ).toBe(0);
  });

  test("builds when any runtime path changed", () => {
    expect(
      decideIgnoreBuild({
        ...validPreview,
        changedPaths: [
          "docs/CACHING_STRATEGY.md",
          "apps/deskohub-workspace/app/page.tsx",
        ],
      }).exitCode
    ).toBe(1);
  });

  test("builds for deployed testing-only routes", () => {
    expect(
      decideIgnoreBuild({
        ...validPreview,
        changedPaths: [
          "apps/deskohub-workspace/app/[locale]/(testing-only)/layout.tsx",
        ],
      }).exitCode
    ).toBe(1);
  });

  test("builds outside preview and for fresh E2E deployments", () => {
    expect(
      decideIgnoreBuild({
        ...validPreview,
        changedPaths: ["README.md"],
        vercelEnvironment: "production",
      }).exitCode
    ).toBe(1);
    expect(
      decideIgnoreBuild({
        ...validPreview,
        changedPaths: ["README.md"],
        e2eMarker: "HUMAN",
      }).exitCode
    ).toBe(1);
  });

  test("builds when the previous SHA is missing or invalid", () => {
    expect(
      decideIgnoreBuild({
        changedPaths: ["README.md"],
        vercelEnvironment: "preview",
      }).exitCode
    ).toBe(1);
    expect(
      decideIgnoreBuild({
        changedPaths: ["README.md"],
        previousSha: "not-a-sha",
        vercelEnvironment: "preview",
      }).exitCode
    ).toBe(1);
  });

  test("builds when Git fails or returns an empty diff", () => {
    expect(
      decideIgnoreBuild({
        ...validPreview,
        gitDiffFailed: true,
      }).exitCode
    ).toBe(1);
    expect(
      decideIgnoreBuild({ ...validPreview, changedPaths: [] }).exitCode
    ).toBe(1);
  });

  test("builds when a runtime file is renamed into an allowed path", () => {
    expect(
      decideIgnoreBuild({
        ...validPreview,
        changedPaths: [
          "apps/deskohub-workspace/app/legacy-page.tsx",
          "docs/legacy-page.test.tsx",
        ],
      }).exitCode
    ).toBe(1);
  });
});

describe("Git diff", () => {
  test("parses NUL-delimited paths without treating newlines as separators", () => {
    expect(
      parseChangedPaths(
        new TextEncoder().encode("README.md\0docs/line\nbreak.md\0")
      )
    ).toEqual(["README.md", "docs/line\nbreak.md"]);
  });

  test("disables rename detection and requests NUL-delimited paths", () => {
    const args = getGitDiffArgs(validPreview.previousSha);
    expect(args).toContain("--no-renames");
    expect(args).toContain("--name-only");
    expect(args).toContain("-z");
    expect(args).toContain(`${validPreview.previousSha}...HEAD`);
  });
});
