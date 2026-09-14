import { describe, expect, test } from "bun:test";
import { normalizeHostname } from "./hostname";

describe("normalizeHostname", () => {
  test.each([
    ["  Telemetry.Example  ", "telemetry.example"],
    ["telemetry.example.", "telemetry.example"],
    ["telemetry.example...", "telemetry.example"],
    [".", ""],
    ["...", ""],
  ])("normalizes %j", (hostname, normalizedHostname) => {
    expect(normalizeHostname(hostname)).toBe(normalizedHostname);
  });
});
