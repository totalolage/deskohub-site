import { expect, test } from "bun:test";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  isProtectedAccountSignInUrl,
  parseBrowserAuthSession,
} from "./account";

test("recognizes only an exact protected-account sign-in redirect", () => {
  const config = makeConfig();
  expect(
    isProtectedAccountSignInUrl(
      `${config.baseUrl}/en-US/auth/sign-in?redirectTo=/en-US/account`,
      config
    )
  ).toBeTrue();
  expect(
    isProtectedAccountSignInUrl(
      `${config.baseUrl}/en-US/auth/sign-in?redirectTo=/en-US/admin`,
      config
    )
  ).toBeFalse();
  expect(
    isProtectedAccountSignInUrl(
      "https://example.com/en-US/auth/sign-in?redirectTo=/en-US/account",
      config
    )
  ).toBeFalse();
});

test("parses authoritative Neon Auth sessions without depending on cookies", () => {
  expect(parseBrowserAuthSession("null")).toBeUndefined();
  expect(
    parseBrowserAuthSession(
      JSON.stringify({
        session: { id: "session-id" },
        user: { email: "synthetic@example.test", id: "user-id", name: "Name" },
      })
    )
  ).toEqual({
    user: { email: "synthetic@example.test", id: "user-id", name: "Name" },
  });
});

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: "test-protection-bypass",
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
});
