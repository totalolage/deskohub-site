import { expect, mock, test } from "bun:test";
import {
  configureWorkspaceBotId,
  initializeWorkspaceBotId,
  isWorkspaceBotIdEnforced,
} from "./bot-protection.policy.js";

for (const [vercelEnvironment, enforced] of [
  ["production", true],
  ["preview", false],
  ["development", false],
  [undefined, false],
] as const) {
  test(`BotID enforcement is ${enforced ? "enabled" : "disabled"} in ${vercelEnvironment ?? "an unknown environment"}`, () => {
    expect(isWorkspaceBotIdEnforced(vercelEnvironment)).toBe(enforced);
  });
}

test("initializes the BotID client only in production", () => {
  const initialize = mock(() => undefined);

  initializeWorkspaceBotId("preview", initialize);
  initializeWorkspaceBotId("development", initialize);
  expect(initialize).not.toHaveBeenCalled();

  initializeWorkspaceBotId("production", initialize);
  expect(initialize).toHaveBeenCalledTimes(1);
});

test("adds BotID build configuration only in production", () => {
  const config = {};
  const configured = { configured: true };
  const configure = mock(() => configured);

  expect(configureWorkspaceBotId(config, "preview", configure)).toBe(config);
  expect(configureWorkspaceBotId(config, "development", configure)).toBe(
    config
  );
  expect(configure).not.toHaveBeenCalled();

  expect(configureWorkspaceBotId(config, "production", configure)).toBe(
    configured
  );
  expect(configure).toHaveBeenCalledTimes(1);
  expect(configure).toHaveBeenCalledWith(config);
});
