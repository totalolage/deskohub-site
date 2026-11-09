import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Data } from "effect";
import { classifyErrorType } from "./log-classification";

class SyntheticAccountError extends Data.TaggedError("SyntheticAccountError")<{
  readonly message: string;
}> {}

describe("classifyErrorType", () => {
  test("keeps built-in JavaScript and DOM error names", () => {
    expect(classifyErrorType(new Error("synthetic"))).toBe("Error");
    expect(classifyErrorType(new TypeError("synthetic"))).toBe("TypeError");
    expect(classifyErrorType(new RangeError("synthetic"))).toBe("RangeError");
    expect(classifyErrorType(new DOMException("synthetic", "AbortError"))).toBe(
      "AbortError"
    );
    expect(
      classifyErrorType(new DOMException("synthetic", "TimeoutError"))
    ).toBe("TimeoutError");
  });

  test("never passes identifier-shaped personal data or secrets through", () => {
    const email = testEmailAddress("classification");
    const renamed = new Error(email);
    renamed.name = "Synthetic-Alice-Smith";

    expect(classifyErrorType({ name: "Synthetic-Alice-Smith" })).toBe(
      "unclassified"
    );
    expect(classifyErrorType({ _tag: "synthetic-secret-token" })).toBe(
      "unclassified"
    );
    expect(classifyErrorType({ _tag: "sk_live_synthetic123" })).toBe(
      "unclassified"
    );
    expect(classifyErrorType(renamed)).toBe("unclassified");
    expect(classifyErrorType({ name: email })).toBe("unclassified");
  });

  test("prefers a tag over a trusted name", () => {
    expect(
      classifyErrorType(new SyntheticAccountError({ message: "synthetic" }))
    ).toBe("unclassified");
    expect(classifyErrorType({ _tag: "Synthetic", name: "Error" })).toBe(
      "unclassified"
    );
  });

  test("classifies values without a type as unclassified", () => {
    expect(classifyErrorType("synthetic-secret-token")).toBe("unclassified");
    expect(classifyErrorType(undefined)).toBe("unclassified");
    expect(classifyErrorType({ name: 42 })).toBe("unclassified");
  });
});
