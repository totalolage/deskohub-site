import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  getWorkspaceProductKey,
  workspaceProductKeySchema,
} from "@/features/checkout/product-identity";

describe("workspace product identities", () => {
  test("dispatches canonical keys to their reservation-family domain", () => {
    expect(getWorkspaceProductKey({ kind: "cowork", tier: "basic" })).toBe(
      "cowork:basic"
    );
    expect(
      getWorkspaceProductKey({ kind: "meeting-room", durationMinutes: 60 })
    ).toBe("meeting-room:60");
  });

  test("rejects non-canonical product keys", () => {
    const decode = Schema.decodeUnknownSync(workspaceProductKeySchema);

    expect(() => decode("cowork:enterprise")).toThrow();
    expect(() => decode("meeting-room:4")).toThrow();
    expect(() => decode("meeting-room:240-minutes")).toThrow();
  });
});
