import { describe, expect, test } from "bun:test";
import { getProviderOperationTimelineTone } from "./payment-presentation";

describe("getProviderOperationTimelineTone", () => {
  test.each([
    ["AUTHORIZATION", "AUTHORIZED", "positive"],
    ["CAPTURE", "EXECUTED", "positive"],
    ["REFUND", "EXECUTED", "warning"],
    ["VOID", "EXECUTED", "warning"],
    ["AUTHORIZATION", "CANCELLED", "warning"],
    ["AUTHORIZATION", "PENDING", "neutral"],
    [undefined, undefined, "neutral"],
    ["FUTURE_OPERATION", "FUTURE_RESULT", "neutral"],
  ] as const)("classifies %s / %s as %s", (type, result, expected) => {
    expect(getProviderOperationTimelineTone(type, result)).toBe(expected);
  });
});
