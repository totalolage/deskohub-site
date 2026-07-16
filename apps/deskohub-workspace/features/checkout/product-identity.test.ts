import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  getWorkspaceProductKey,
  workspaceProductKeySchema,
} from "@/features/checkout/product-identity";

describe("workspace product identities", () => {
  test("creates canonical cowork product keys", () => {
    expect(getWorkspaceProductKey({ kind: "cowork", tier: "basic" })).toBe(
      "cowork:basic"
    );
    expect(getWorkspaceProductKey({ kind: "cowork", tier: "plus" })).toBe(
      "cowork:plus"
    );
    expect(getWorkspaceProductKey({ kind: "cowork", tier: "profi" })).toBe(
      "cowork:profi"
    );
  });

  test("creates canonical meeting-room product keys from minute durations", () => {
    expect(
      getWorkspaceProductKey({ kind: "meeting-room", durationMinutes: 60 })
    ).toBe("meeting-room:60");
    expect(
      getWorkspaceProductKey({ kind: "meeting-room", durationMinutes: 240 })
    ).toBe("meeting-room:240");
    expect(
      getWorkspaceProductKey({ kind: "meeting-room", durationMinutes: 1440 })
    ).toBe("meeting-room:1440");
  });

  test("rejects non-canonical product keys", () => {
    const decode = Schema.decodeUnknownSync(workspaceProductKeySchema);

    expect(() => decode("cowork:enterprise")).toThrow();
    expect(() => decode("meeting-room:4")).toThrow();
    expect(() => decode("meeting-room:240-minutes")).toThrow();
  });
});
