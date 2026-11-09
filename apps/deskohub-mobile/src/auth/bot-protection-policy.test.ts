import { expect, test } from "bun:test";
import { productionApiOrigin } from "./api-origin";
import {
  botProtectedAuthRequests,
  isBotProtectionEnforced,
} from "./bot-protection-policy";

test("BotID runs only on the production deployment", () => {
  expect(isBotProtectionEnforced("production", undefined)).toBe(true);
  expect(isBotProtectionEnforced("preview", productionApiOrigin)).toBe(false);
  expect(isBotProtectionEnforced("development", undefined)).toBe(false);
  expect(isBotProtectionEnforced(undefined, productionApiOrigin)).toBe(true);
  expect(
    isBotProtectionEnforced(
      undefined,
      "https://deskohub-workspace-site-abc.vercel.app"
    )
  ).toBe(false);
  expect(isBotProtectionEnforced(undefined, "http://localhost:8081")).toBe(
    false
  );
  expect(isBotProtectionEnforced(undefined, undefined)).toBe(false);
});

test("BotID covers the sign-in email and sign-in code requests", () => {
  expect(botProtectedAuthRequests).toEqual([
    { path: "/api/auth/sign-in/magic-link", method: "POST" },
    { path: "/api/auth/sign-in/email-otp", method: "POST" },
  ]);
});
