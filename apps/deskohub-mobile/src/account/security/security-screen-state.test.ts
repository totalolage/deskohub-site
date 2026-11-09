import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { SignInUnavailable } from "../../auth/native-sign-in-errors";
import { type PasskeyRow, passkeyNameMaximumLength } from "./passkeys";
import {
  initialSecurityScreenState,
  reauthenticationPrompt,
  renameSubmission,
  renameValidation,
  SecurityScreenEvent,
  type SecurityScreenState,
  securityScreenReducer,
  shownPasskeyName,
} from "./security-screen-state";

const passkey: PasskeyRow = {
  id: "passkey-1",
  name: "Phone",
  provider: undefined,
  createdAt: Option.none(),
};

const run = (...events: ReadonlyArray<SecurityScreenEvent>) =>
  events.reduce<SecurityScreenState>(
    securityScreenReducer,
    initialSecurityScreenState
  );

const renaming = (draft: string) =>
  run(
    SecurityScreenEvent.RenameOpened({ passkey }),
    SecurityScreenEvent.DraftChanged({ draft })
  );

const deleting = (passkeyCount = 2) =>
  run(SecurityScreenEvent.DeleteOpened({ passkey, passkeyCount }));

const idle = { status: "idle" } as const;
const running = { status: "running" } as const;

describe("the rename dialog", () => {
  test("starts from the passkey's shown name", () => {
    expect(run(SecurityScreenEvent.RenameOpened({ passkey })).dialog).toEqual({
      kind: "rename",
      passkey,
      draft: passkey.name,
      submitted: false,
      failure: undefined,
    });
  });

  test("saves a valid new name, trimmed", () => {
    const state = renaming("  Laptop ");
    expect(renameSubmission(state.dialog, passkey.name)).toEqual({
      _tag: "Save",
      id: passkey.id,
      name: "Laptop",
    });
    expect(
      securityScreenReducer(
        state,
        SecurityScreenEvent.RenameSubmitted({ shownName: passkey.name })
      ).dialog
    ).toMatchObject({ kind: "rename", draft: "  Laptop " });
  });

  test("closes without a request for the unchanged name", () => {
    const state = renaming(` ${passkey.name} `);
    expect(renameSubmission(state.dialog, passkey.name)._tag).toBe("Close");
    expect(
      securityScreenReducer(
        state,
        SecurityScreenEvent.RenameSubmitted({ shownName: passkey.name })
      ).dialog
    ).toBeUndefined();
  });

  test.each([
    ["an empty name", "", "Required"],
    ["a blank name", "   ", "Required"],
    [
      "a name over the maximum",
      "a".repeat(passkeyNameMaximumLength + 1),
      "TooLong",
    ],
  ] as const)("refuses %s on save", (_case, draft, expected) => {
    const state = renaming(draft);
    expect(renameSubmission(state.dialog, passkey.name)._tag).toBe("Invalid");
    expect(renameValidation(state.dialog)).toBeUndefined();

    const submitted = securityScreenReducer(
      state,
      SecurityScreenEvent.RenameSubmitted({ shownName: passkey.name })
    );

    expect(submitted.dialog).toMatchObject({ kind: "rename", submitted: true });
    expect(renameValidation(submitted.dialog)?._tag).toBe(expected);
  });

  test("revalidates as the draft changes after a save", () => {
    const submitted = securityScreenReducer(
      renaming(""),
      SecurityScreenEvent.RenameSubmitted({ shownName: passkey.name })
    );
    const fixed = securityScreenReducer(
      submitted,
      SecurityScreenEvent.DraftChanged({ draft: "Laptop" })
    );
    expect(renameValidation(fixed.dialog)).toBeUndefined();
  });

  test("a saved name closes the dialog and is announced", () => {
    const state = run(
      SecurityScreenEvent.RenameOpened({ passkey }),
      SecurityScreenEvent.WriteStarted(),
      SecurityScreenEvent.WriteEnded({ outcome: "succeeded" })
    );
    expect(state.dialog).toBeUndefined();
    expect(state.announcement).toBe("renamed");
  });

  test.each(["failed", "unconfirmed"] as const)(
    "a %s rename keeps the dialog and the draft",
    (outcome) => {
      const state = securityScreenReducer(
        renaming("Laptop"),
        SecurityScreenEvent.WriteEnded({ outcome })
      );
      expect(state.dialog).toMatchObject({
        kind: "rename",
        draft: "Laptop",
        failure: outcome,
      });
      expect(state.announcement).toBeUndefined();
    }
  );

  test("trying again clears the last failure", () => {
    const state = run(
      SecurityScreenEvent.RenameOpened({ passkey }),
      SecurityScreenEvent.WriteEnded({ outcome: "failed" }),
      SecurityScreenEvent.WriteStarted()
    );
    expect(state.dialog?.failure).toBeUndefined();
  });
});

describe("a rename whose outcome is unknown", () => {
  test("compares a later save with the name the refreshed list shows", () => {
    const open = securityScreenReducer(
      renaming("Laptop"),
      SecurityScreenEvent.WriteEnded({ outcome: "unconfirmed" })
    );
    const refreshed = [{ ...passkey, name: "Laptop" }];
    const restored = securityScreenReducer(
      open,
      SecurityScreenEvent.DraftChanged({ draft: passkey.name })
    );
    if (restored.dialog === undefined) throw new Error("The dialog stays open");
    const shownName = shownPasskeyName(restored.dialog, refreshed);

    expect(shownName).toBe("Laptop");
    expect(renameSubmission(restored.dialog, shownName)).toEqual({
      _tag: "Save",
      id: passkey.id,
      name: passkey.name,
    });
    expect(
      securityScreenReducer(
        restored,
        SecurityScreenEvent.RenameSubmitted({ shownName })
      ).dialog
    ).toMatchObject({ kind: "rename", draft: passkey.name });
  });

  test("keeps the opened name while the passkey isn't listed", () => {
    const { dialog } = renaming("Laptop");
    if (dialog === undefined) throw new Error("The dialog is open");
    expect(shownPasskeyName(dialog, undefined)).toBe(passkey.name);
    expect(shownPasskeyName(dialog, [])).toBe(passkey.name);
  });
});

describe("the delete dialog", () => {
  test("warns when it is the account's only passkey", () => {
    expect(deleting(1).dialog).toMatchObject({ kind: "delete", last: true });
  });

  test("doesn't warn while other passkeys remain", () => {
    expect(deleting(2).dialog).toMatchObject({ kind: "delete", last: false });
  });

  test("a deletion closes the dialog and is announced", () => {
    const state = securityScreenReducer(
      deleting(),
      SecurityScreenEvent.WriteEnded({ outcome: "succeeded" })
    );
    expect(state.dialog).toBeUndefined();
    expect(state.announcement).toBe("deleted");
  });

  test("a failed deletion stays in the dialog", () => {
    expect(
      securityScreenReducer(
        deleting(),
        SecurityScreenEvent.WriteEnded({ outcome: "failed" })
      ).dialog
    ).toMatchObject({ kind: "delete", failure: "failed" });
  });

  test("cancelling closes it", () => {
    expect(
      securityScreenReducer(deleting(), SecurityScreenEvent.DialogCancelled())
        .dialog
    ).toBeUndefined();
  });
});

describe("a passkey already removed", () => {
  test.each([
    ["renaming", () => renaming("Laptop")],
    ["deleting", () => deleting()],
  ])("closes the dialog while %s and says it's gone", (_case, open) => {
    const state = securityScreenReducer(
      open(),
      SecurityScreenEvent.WriteEnded({ outcome: "gone" })
    );
    expect(state.dialog).toBeUndefined();
    expect(state.announcement).toBe("gone");
  });
});

describe("an old sign-in", () => {
  test("a refused change stays in its dialog and asks the customer to confirm it's them", () => {
    const state = securityScreenReducer(
      deleting(),
      SecurityScreenEvent.WriteEnded({ outcome: "reauthentication-required" })
    );
    expect(state.dialog).toMatchObject({
      kind: "delete",
      failure: "reauthentication-required",
    });
    expect(reauthenticationPrompt(state.reauthentication, idle)).toEqual({
      required: true,
      notice: undefined,
    });
  });

  test("adding a passkey asks the customer to confirm it's them", () => {
    const state = run(SecurityScreenEvent.AddReauthenticationRequired());
    expect(state.dialog).toBeUndefined();
    expect(reauthenticationPrompt(state.reauthentication, running)).toEqual({
      required: true,
      notice: { kind: "confirming" },
    });
  });

  test("once confirmed, the customer is told to try again", () => {
    const state = run(
      SecurityScreenEvent.AddReauthenticationRequired(),
      SecurityScreenEvent.ReauthenticationEnded({ outcome: "reauthenticated" })
    );
    expect(reauthenticationPrompt(state.reauthentication, idle)).toEqual({
      required: false,
      notice: { kind: "confirmed" },
    });
  });

  test("a failed confirmation keeps asking and says why", () => {
    const failure = new SignInUnavailable({});
    const state = run(
      SecurityScreenEvent.AddReauthenticationRequired(),
      SecurityScreenEvent.ReauthenticationEnded({ outcome: "failed" })
    );
    expect(
      reauthenticationPrompt(state.reauthentication, {
        status: "failed",
        failure,
      })
    ).toEqual({ required: true, notice: { kind: "failed", failure } });
  });

  test.each([
    ["the added passkey", SecurityScreenEvent.PasskeyAdded()],
    ["a repeated change", SecurityScreenEvent.WriteStarted()],
    ["adding a passkey again", SecurityScreenEvent.PasskeyAddStarted()],
  ])("%s spends the confirmation", (_case, event) => {
    const state = run(
      SecurityScreenEvent.AddReauthenticationRequired(),
      SecurityScreenEvent.ReauthenticationEnded({ outcome: "reauthenticated" }),
      event
    );
    expect(reauthenticationPrompt(state.reauthentication, idle)).toEqual({
      required: false,
      notice: undefined,
    });
  });

  test("a confirmation nobody asked for changes nothing", () => {
    expect(
      run(
        SecurityScreenEvent.ReauthenticationEnded({
          outcome: "reauthenticated",
        })
      )
    ).toEqual(initialSecurityScreenState);
  });
});

describe("announcements", () => {
  test("opening another dialog clears the last one, so a repeat is announced again", () => {
    const state = run(
      SecurityScreenEvent.RenameOpened({ passkey }),
      SecurityScreenEvent.WriteEnded({ outcome: "succeeded" }),
      SecurityScreenEvent.RenameOpened({ passkey })
    );
    expect(state.announcement).toBeUndefined();
  });
});

describe("adding a passkey", () => {
  test("holds the passkey controls and says to follow the prompt", () => {
    const state = run(
      SecurityScreenEvent.RenameOpened({ passkey }),
      SecurityScreenEvent.WriteEnded({ outcome: "succeeded" }),
      SecurityScreenEvent.PasskeyAddStarted()
    );
    expect(state.adding).toBe(true);
    expect(state.announcement).toBe("adding");
  });

  test.each([
    ["adds the passkey", [SecurityScreenEvent.PasskeyAdded()]],
    [
      "needs a recent sign-in",
      [SecurityScreenEvent.AddReauthenticationRequired()],
    ],
    ["fails", []],
  ])("releases the controls and the progress once it %s", (_case, events) => {
    const state = run(
      SecurityScreenEvent.PasskeyAddStarted(),
      ...events,
      SecurityScreenEvent.PasskeyAddSettled()
    );
    expect(state.adding).toBe(false);
    expect(state.announcement).toBeUndefined();
  });

  test("stays held until the ceremony has settled", () => {
    const state = run(
      SecurityScreenEvent.PasskeyAddStarted(),
      SecurityScreenEvent.PasskeyAdded()
    );
    expect(state.adding).toBe(true);
  });
});
