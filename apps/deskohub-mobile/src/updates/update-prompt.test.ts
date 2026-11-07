import { describe, expect, test } from "bun:test";
import {
  dismissUpdatePrompt,
  noUpdatePromptDismissals,
  selectUpdatePrompt,
} from "./update-prompt";

const nativeUpdate = { versionName: "1.3.0", versionCode: 1_003_000 };

describe("selectUpdatePrompt", () => {
  test("shows nothing when neither update applies", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdateId: undefined,
        dismissals: noUpdatePromptDismissals,
      })
    ).toBeUndefined();
  });

  test("offers a restart for a downloaded update", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdateId: "update-a",
        dismissals: noUpdatePromptDismissals,
      })
    ).toEqual({ kind: "ota-update", updateId: "update-a" });
  });

  test("offers the new native version", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate,
        readyUpdateId: undefined,
        dismissals: noUpdatePromptDismissals,
      })
    ).toEqual({ kind: "native-release", ...nativeUpdate });
  });

  test("prefers the native version when both apply", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate,
        readyUpdateId: "update-a",
        dismissals: noUpdatePromptDismissals,
      })?.kind
    ).toBe("native-release");
  });

  test("falls back to the downloaded update once the native one is dismissed", () => {
    const dismissals = dismissUpdatePrompt(noUpdatePromptDismissals, {
      kind: "native-release",
      ...nativeUpdate,
    });
    expect(
      selectUpdatePrompt({
        nativeUpdate,
        readyUpdateId: "update-a",
        dismissals,
      })
    ).toEqual({ kind: "ota-update", updateId: "update-a" });
  });

  test("offers a later native version after an earlier one was dismissed", () => {
    const dismissals = dismissUpdatePrompt(noUpdatePromptDismissals, {
      kind: "native-release",
      ...nativeUpdate,
    });
    const later = { versionName: "1.4.0", versionCode: 1_004_000 };
    expect(
      selectUpdatePrompt({
        nativeUpdate: later,
        readyUpdateId: undefined,
        dismissals,
      })
    ).toEqual({ kind: "native-release", ...later });
  });

  test("hides a dismissed downloaded update but offers the next one", () => {
    const dismissals = dismissUpdatePrompt(noUpdatePromptDismissals, {
      kind: "ota-update",
      updateId: "update-a",
    });
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdateId: "update-a",
        dismissals,
      })
    ).toBeUndefined();
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdateId: "update-b",
        dismissals,
      })
    ).toEqual({ kind: "ota-update", updateId: "update-b" });
  });

  test("dismissing one prompt kind leaves the other kind's dismissals alone", () => {
    const dismissals = dismissUpdatePrompt(
      dismissUpdatePrompt(noUpdatePromptDismissals, {
        kind: "ota-update",
        updateId: "update-a",
      }),
      { kind: "native-release", ...nativeUpdate }
    );
    expect(
      selectUpdatePrompt({
        nativeUpdate,
        readyUpdateId: "update-a",
        dismissals,
      })
    ).toBeUndefined();
    expect(noUpdatePromptDismissals.updateIds.size).toBe(0);
    expect(noUpdatePromptDismissals.versionCodes.size).toBe(0);
  });
});
