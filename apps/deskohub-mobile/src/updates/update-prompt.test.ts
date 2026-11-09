import { describe, expect, test } from "bun:test";
import type { ReadyUpdate } from "./ota-update";
import {
  dismissUpdatePrompt,
  noUpdatePromptDismissals,
  selectUpdatePrompt,
  updatePromptWaitsForConsent,
} from "./update-prompt";

const nativeUpdate = { versionName: "1.3.0", versionCode: 1_003_000 };

const downloaded = (updateId: string): ReadyUpdate => ({
  kind: "update",
  updateId,
});

const embedded: ReadyUpdate = { kind: "embedded" };

describe("selectUpdatePrompt", () => {
  test("shows nothing when neither update applies", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdate: undefined,
        runsEmbeddedUpdate: false,
        dismissals: noUpdatePromptDismissals,
      })
    ).toBeUndefined();
  });

  test("offers a restart for a downloaded update", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdate: downloaded("update-a"),
        runsEmbeddedUpdate: false,
        dismissals: noUpdatePromptDismissals,
      })
    ).toEqual({ kind: "ota-update", updateId: "update-a" });
  });

  test("offers the new native version", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate,
        readyUpdate: undefined,
        runsEmbeddedUpdate: false,
        dismissals: noUpdatePromptDismissals,
      })
    ).toEqual({ kind: "native-release", ...nativeUpdate });
  });

  test("prefers the native version when both apply", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate,
        readyUpdate: downloaded("update-a"),
        runsEmbeddedUpdate: false,
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
        readyUpdate: downloaded("update-a"),
        runsEmbeddedUpdate: false,
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
        readyUpdate: undefined,
        runsEmbeddedUpdate: false,
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
        readyUpdate: downloaded("update-a"),
        runsEmbeddedUpdate: false,
        dismissals,
      })
    ).toBeUndefined();
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdate: downloaded("update-b"),
        runsEmbeddedUpdate: false,
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
        readyUpdate: downloaded("update-a"),
        runsEmbeddedUpdate: false,
        dismissals,
      })
    ).toBeUndefined();
    expect(noUpdatePromptDismissals.updateIds.size).toBe(0);
    expect(noUpdatePromptDismissals.versionCodes.size).toBe(0);
  });
});

describe("selectUpdatePrompt after a rollback", () => {
  test("offers a restart into the embedded update while an update runs", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdate: embedded,
        runsEmbeddedUpdate: false,
        dismissals: noUpdatePromptDismissals,
      })
    ).toEqual({ kind: "roll-back" });
  });

  test("offers nothing when the app already runs its embedded update", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdate: embedded,
        runsEmbeddedUpdate: true,
        dismissals: noUpdatePromptDismissals,
      })
    ).toBeUndefined();
  });

  test("still prefers the native version", () => {
    expect(
      selectUpdatePrompt({
        nativeUpdate,
        readyUpdate: embedded,
        runsEmbeddedUpdate: false,
        dismissals: noUpdatePromptDismissals,
      })?.kind
    ).toBe("native-release");
  });

  test("hides a dismissed rollback but offers a later downloaded update", () => {
    const dismissals = dismissUpdatePrompt(noUpdatePromptDismissals, {
      kind: "roll-back",
    });
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdate: embedded,
        runsEmbeddedUpdate: false,
        dismissals,
      })
    ).toBeUndefined();
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdate: downloaded("update-b"),
        runsEmbeddedUpdate: false,
        dismissals,
      })
    ).toEqual({ kind: "ota-update", updateId: "update-b" });
  });

  test("a dismissed downloaded update doesn't hide the rollback that replaced it", () => {
    const dismissals = dismissUpdatePrompt(noUpdatePromptDismissals, {
      kind: "ota-update",
      updateId: "update-a",
    });
    expect(
      selectUpdatePrompt({
        nativeUpdate: undefined,
        readyUpdate: embedded,
        runsEmbeddedUpdate: false,
        dismissals,
      })
    ).toEqual({ kind: "roll-back" });
  });
});

describe("updatePromptWaitsForConsent", () => {
  test("holds the banner while the consent prompt can still show", () => {
    expect(updatePromptWaitsForConsent("loading")).toBe(true);
    expect(updatePromptWaitsForConsent("undecided")).toBe(true);
  });

  test("shows the banner once consent has an answer", () => {
    expect(updatePromptWaitsForConsent("granted")).toBe(false);
    expect(updatePromptWaitsForConsent("denied")).toBe(false);
  });
});
