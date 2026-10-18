import { describe, expect, test } from "bun:test";
import { DEFAULT_SERVER_ERROR_MESSAGE } from "next-safe-action";
import {
  actionRuntimeFailureMessages,
  createActionFailureMessage,
  getActionFailureMessage,
  getActionRuntimeFailure,
} from "./action-runtime-failure";

describe("action runtime failures", () => {
  test("keep next-safe-action's default message for unexpected failures", () => {
    expect(actionRuntimeFailureMessages.unexpected).toBe(
      DEFAULT_SERVER_ERROR_MESSAGE
    );
  });

  test("recognises each runtime failure from its server error", () => {
    expect(
      getActionRuntimeFailure("Request timed out. Please try again.")
    ).toBe("timeout");
    expect(
      getActionRuntimeFailure(
        "Validation error occurred. Please check your input."
      )
    ).toBe("invalidInput");
    expect(getActionRuntimeFailure(DEFAULT_SERVER_ERROR_MESSAGE)).toBe(
      "unexpected"
    );
    expect(getActionRuntimeFailure("Kód už existuje.")).toBeUndefined();
  });

  test("shows the action's public message unchanged", () => {
    expect(
      getActionFailureMessage("Kód už existuje.", {
        fallback: "Uložení selhalo.",
        timeout: "Vypršel čas.",
      })
    ).toBe("Kód už existuje.");
  });

  test("replaces a runtime failure with the caller's copy", () => {
    expect(
      getActionFailureMessage(actionRuntimeFailureMessages.timeout, {
        fallback: "Uložení selhalo.",
        timeout: "Vypršel čas.",
        unexpected: "Něco se pokazilo.",
      })
    ).toBe("Vypršel čas.");
    expect(
      getActionFailureMessage(actionRuntimeFailureMessages.unexpected, {
        fallback: "Uložení selhalo.",
        timeout: "Vypršel čas.",
        unexpected: "Něco se pokazilo.",
      })
    ).toBe("Něco se pokazilo.");
  });

  test("falls back when the server sent no message or the caller has no copy", () => {
    expect(
      getActionFailureMessage(undefined, { fallback: "Zkontrolujte formulář." })
    ).toBe("Zkontrolujte formulář.");
    expect(
      getActionFailureMessage(actionRuntimeFailureMessages.invalidInput, {
        fallback: "Zkontrolujte formulář.",
      })
    ).toBe("Zkontrolujte formulář.");
  });
});

describe("createActionFailureMessage", () => {
  const getFailureMessage = createActionFailureMessage<"cs-CZ" | "en-US">({
    timeout: (_inputs, { locale }) =>
      locale === "cs-CZ" ? "Vypršel čas." : "Timed out.",
    unexpected: (_inputs, { locale }) =>
      locale === "cs-CZ" ? "Něco se pokazilo." : "Something broke.",
  });

  test("replaces a runtime failure with the area's copy in the operator's locale", () => {
    expect(
      getFailureMessage(actionRuntimeFailureMessages.timeout, {
        fallback: "Uložení selhalo.",
        locale: "cs-CZ",
      })
    ).toBe("Vypršel čas.");
    expect(
      getFailureMessage(actionRuntimeFailureMessages.unexpected, {
        fallback: "Saving failed.",
        locale: "en-US",
      })
    ).toBe("Something broke.");
  });

  test("keeps the action's public message and falls back otherwise", () => {
    expect(
      getFailureMessage("Kód už existuje.", {
        fallback: "Uložení selhalo.",
        locale: "cs-CZ",
      })
    ).toBe("Kód už existuje.");
    expect(
      getFailureMessage(undefined, {
        fallback: "Uložení selhalo.",
        locale: "cs-CZ",
      })
    ).toBe("Uložení selhalo.");
    expect(
      getFailureMessage(actionRuntimeFailureMessages.invalidInput, {
        fallback: "Uložení selhalo.",
        locale: "cs-CZ",
      })
    ).toBe("Uložení selhalo.");
  });
});
