import { describe, expect, test } from "bun:test";
import { formatError } from "./error-formatting";

describe("formatError", () => {
  test("keeps a tagged error's code, message, and details", () => {
    expect(
      formatError({
        _tag: "NotFound",
        code: "MENU_NOT_FOUND",
        message: "Menu missing",
        details: { id: 1 },
      })
    ).toEqual({
      code: "MENU_NOT_FOUND",
      message: "Menu missing",
      details: { id: 1 },
    });
  });

  test("falls back to the tag and a generic message for a bare tagged error", () => {
    const formatted = formatError({ _tag: "NotFound", code: "", message: "" });

    expect(formatted.code).toBe("NotFound");
    // Every bare tagged error shares one non-empty generic message.
    expect(formatted.message).not.toBe("");
    expect(formatted.message).toBe(
      formatError({ _tag: "Conflict", code: "", message: "" }).message
    );
    expect(formatted.details).toBeUndefined();
  });

  test("reports an Error's message and stack under the unknown code", () => {
    const error = new Error("Boom");

    expect(formatError(error)).toEqual({
      code: "UNKNOWN_ERROR",
      message: "Boom",
      details: error.stack,
    });
  });

  test("treats an object whose tag is not a string as an Error", () => {
    const error = Object.assign(new Error("Tagged"), { _tag: 42 });

    expect(formatError(error)).toEqual({
      code: "UNKNOWN_ERROR",
      message: "Tagged",
      details: error.stack,
    });
  });

  test.each([
    ["a string", "plain failure", "plain failure"],
    ["null", null, "null"],
    ["an untagged object", { reason: "x" }, "[object Object]"],
  ])("stringifies %s", (_label, error, message) => {
    expect(formatError(error)).toEqual({ code: "UNKNOWN_ERROR", message });
  });
});
