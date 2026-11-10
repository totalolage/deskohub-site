import { describe, expect, test } from "bun:test";
import {
  accountPhoneRegion,
  type CustomerAccountState,
  type CustomerProfile,
} from "@deskohub/workspace-customer-api";
import { Effect, Option } from "effect";
import {
  type AsyncResult,
  type Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import {
  sampleInvitationCode,
  sampleProfile,
} from "../../customer-api/testing/sample-fixtures";
import { completionDraftOf, profileDraftOf } from "./profile-draft";
import {
  completeProfileAtom,
  completionEditsAtom,
  currentDraft,
  type EditedProfile,
  editedDraft,
  hasUnsavedChanges,
  invitationCodeOf,
  profileEditsAtom,
  profileSubmitState,
  saveProfileAtom,
} from "./profile-save";

/** The phone region of an account without a saved language: Czech. */
const phoneRegion = accountPhoneRegion(null);

const edited = (profile: CustomerProfile): EditedProfile => ({
  profile,
  phoneRegion,
});

const submit = async <A, E, W>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Writable<AsyncResult.AsyncResult<A, E>, W>,
  value: W
) => {
  registry.mount(atom);
  registry.set(atom, value);
  await Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
    )
  );
  return profileSubmitState(
    registry.get(atom) as Parameters<typeof profileSubmitState>[0]
  );
};

const storedAccount = (workspace: {
  data: { account: CustomerAccountState };
}) => workspace.data.account;

const linkedProfileOf = (account: CustomerAccountState) => {
  if (account.kind !== "linked") throw new Error(`not linked: ${account.kind}`);
  return account.profile;
};

describe("unsaved changes", () => {
  test("an untouched form follows the saved profile", () => {
    expect(currentDraft(Option.none(), edited(sampleProfile))).toEqual(
      profileDraftOf(sampleProfile, phoneRegion)
    );
    expect(hasUnsavedChanges(Option.none(), edited(sampleProfile))).toBe(false);
  });

  test("a change counts as unsaved until it matches the saved profile again", () => {
    const edits = editedDraft(Option.none(), edited(sampleProfile), {
      city: "Elsewhere",
    });
    expect(hasUnsavedChanges(edits, edited(sampleProfile))).toBe(true);
    const reverted = editedDraft(edits, edited(sampleProfile), {
      city: "Sampletown",
    });
    expect(hasUnsavedChanges(reverted, edited(sampleProfile))).toBe(false);
  });

  test("a change keeps every other field of the draft", () => {
    const edits = editedDraft(Option.none(), edited(sampleProfile), {
      firstName: "Al",
    });
    expect(currentDraft(edits, edited(sampleProfile))).toEqual({
      ...profileDraftOf(sampleProfile, phoneRegion),
      firstName: "Al",
    });
  });
});

describe("saveProfileAtom", () => {
  test("a name edit saves the complete profile, billing included", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    await settle(registry, accountAtom);
    const draft = {
      ...profileDraftOf(sampleProfile, phoneRegion),
      firstName: "Alexa",
    };
    registry.set(profileEditsAtom, Option.some(draft));

    const state = await submit(registry, saveProfileAtom, {
      draft,
      phoneRegion,
    });

    expect(state._tag).toBe("Done");
    // The Workspace stores the entered phone as its phone number.
    expect(linkedProfileOf(storedAccount(workspace))).toEqual({
      ...sampleProfile,
      firstName: "Alexa",
      phone: "+420600000000",
    });
    expect(workspace.calls).toEqual([
      "getAccount",
      "updateProfile",
      "getAccount",
    ]);
    expect(registry.get(profileEditsAtom)).toEqual(Option.none());
  });

  test("a billing edit keeps the name and phone", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    await settle(registry, accountAtom);
    const draft = {
      ...profileDraftOf(sampleProfile, phoneRegion),
      billingKind: "personal" as const,
      city: "Othertown",
    };

    await submit(registry, saveProfileAtom, { draft, phoneRegion });

    expect(linkedProfileOf(storedAccount(workspace))).toMatchObject({
      firstName: "Alex",
      lastName: "Sample",
      phone: "+420600000000",
      billing: { kind: "personal", city: "Othertown", companyName: null },
    });
  });

  test("an invalid draft sends nothing and names the field to focus", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    await settle(registry, accountAtom);

    const state = await submit(registry, saveProfileAtom, {
      draft: {
        ...profileDraftOf(sampleProfile, phoneRegion),
        firstName: "",
      },
      phoneRegion,
    });

    expect(state).toMatchObject({
      _tag: "Invalid",
      invalid: { fields: { firstName: "required" } },
    });
    expect(state._tag === "Invalid" && state.invalid.first).toEqual(
      Option.some("firstName")
    );
    expect(workspace.calls).toEqual(["getAccount"]);
  });

  test("an unconfirmed save shows the account read again and keeps a draft that differs", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    await settle(registry, accountAtom);
    // The server applies the save (trimming the name), then the connection breaks.
    workspace.fail("updateProfile", "transport-failure");
    const draft = {
      ...profileDraftOf(sampleProfile, phoneRegion),
      firstName: "Alexa ",
    };
    registry.set(profileEditsAtom, Option.some(draft));

    const state = await submit(registry, saveProfileAtom, {
      draft,
      phoneRegion,
    });

    expect(state).toMatchObject({
      _tag: "Failed",
      error: { _tag: "Unconfirmed" },
    });
    expect(workspace.calls).toEqual([
      "getAccount",
      "updateProfile",
      "getAccount",
    ]);
    expect(await settle(registry, accountAtom)).toMatchObject({
      success: { profile: { firstName: "Alexa" } },
    });
    const edits = registry.get(profileEditsAtom);
    expect(edits).toEqual(Option.some(draft));
    expect(
      hasUnsavedChanges(
        edits,
        edited(linkedProfileOf(storedAccount(workspace)))
      )
    ).toBe(true);
  });

  test("an unconfirmed save that matches the server leaves nothing unsaved", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    await settle(registry, accountAtom);
    workspace.fail("updateProfile", "unreadable-answer");
    // The phone as the Workspace stores it, so the stored profile matches.
    const draft = {
      ...profileDraftOf(sampleProfile, phoneRegion),
      phone: "+420600000000",
      city: "Othertown",
    };
    registry.set(profileEditsAtom, Option.some(draft));

    await submit(registry, saveProfileAtom, { draft, phoneRegion });

    expect(
      hasUnsavedChanges(
        registry.get(profileEditsAtom),
        edited(linkedProfileOf(storedAccount(workspace)))
      )
    ).toBe(false);
  });

  test("an unconfirmed save of a phone the server normalized leaves nothing unsaved", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    await settle(registry, accountAtom);
    workspace.fail("updateProfile", "unreadable-answer");
    // Typed in national form; the Workspace stores it in E.164.
    const draft = {
      ...profileDraftOf(sampleProfile, phoneRegion),
      phone: "600 000 001",
    };
    registry.set(profileEditsAtom, Option.some(draft));

    await submit(registry, saveProfileAtom, { draft, phoneRegion });

    const stored = linkedProfileOf(storedAccount(workspace));
    expect(stored.phone).toBe("+420600000001");
    expect(registry.get(profileEditsAtom)).toEqual(Option.some(draft));
    expect(
      hasUnsavedChanges(registry.get(profileEditsAtom), edited(stored))
    ).toBe(false);
  });

  test("a refused save keeps the edits and reads nothing again", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    await settle(registry, accountAtom);
    workspace.fail("updateProfile", "rate-limited");
    const draft = {
      ...profileDraftOf(sampleProfile, phoneRegion),
      city: "Othertown",
    };
    registry.set(profileEditsAtom, Option.some(draft));

    const state = await submit(registry, saveProfileAtom, {
      draft,
      phoneRegion,
    });

    expect(state).toMatchObject({
      _tag: "Failed",
      error: { _tag: "RateLimited" },
    });
    expect(workspace.calls).toEqual(["getAccount", "updateProfile"]);
    expect(registry.get(profileEditsAtom)).toEqual(Option.some(draft));
  });

  test("an account that needs linking is read again so the screen gates", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    await settle(registry, accountAtom);
    const supportRequired = makeFakeCustomerData("support-required").workspace;
    workspace.setAccount(storedAccount(supportRequired));

    const state = await submit(registry, saveProfileAtom, {
      draft: profileDraftOf(sampleProfile, phoneRegion),
      phoneRegion,
    });

    expect(state).toMatchObject({
      _tag: "Failed",
      error: { _tag: "LinkRequired", reason: "support-required" },
    });
    expect(await settle(registry, accountAtom)).toMatchObject({
      success: { kind: "support-required" },
    });
    expect(workspace.calls).toEqual([
      "getAccount",
      "updateProfile",
      "getAccount",
    ]);
  });
});

describe("saveProfileAtom for an account with a saved language", () => {
  test("saves a phone read in the phone region of its language", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.setAccount({ ...storedAccount(workspace), locale: "de-DE" });
    await settle(registry, accountAtom);
    const german = accountPhoneRegion("de-DE");
    const draft = {
      ...profileDraftOf(sampleProfile, german),
      phone: "0151 23456789",
    };

    const state = await submit(registry, saveProfileAtom, {
      draft,
      phoneRegion: german,
    });

    expect(state).toMatchObject({ _tag: "Done" });
    expect(linkedProfileOf(storedAccount(workspace)).phone).toBe(
      "+4915123456789"
    );
  });
});

describe("completeProfileAtom", () => {
  const completion = (referralCode: string) => ({
    draft: {
      ...completionDraftOf(undefined),
      firstName: "Jordan",
      referralCode,
    },
    invitationCode: undefined,
    phoneRegion,
  });

  test("creates the profile, reports the referral outcome and links the account", async () => {
    const { registry, workspace } = makeFakeCustomerData("completion-required");
    await settle(registry, accountAtom);

    const state = await submit(
      registry,
      completeProfileAtom,
      completion("FRIEND-1")
    );

    expect(state).toEqual({
      _tag: "Done",
      referral: Option.some({ status: "applied" }),
    });
    expect(workspace.calls).toEqual([
      "getAccount",
      "completeProfile",
      "getAccount",
    ]);
    expect(await settle(registry, accountAtom)).toMatchObject({
      success: { kind: "linked", profile: { firstName: "Jordan" } },
    });
  });

  test("without a referral code there is no referral outcome", async () => {
    const { registry } = makeFakeCustomerData("completion-required");
    await settle(registry, accountAtom);

    expect(await submit(registry, completeProfileAtom, completion(""))).toEqual(
      { _tag: "Done", referral: Option.none() }
    );
  });

  test("a refused referral code marks the field and creates nothing", async () => {
    const { registry, workspace } = makeFakeCustomerData("completion-required");
    await settle(registry, accountAtom);
    workspace.referralCodeAnswer = "unavailable";

    const state = await submit(
      registry,
      completeProfileAtom,
      completion("NOPE")
    );

    expect(state).toMatchObject({
      _tag: "Invalid",
      invalid: {
        fields: { referralCode: "invalid" },
        first: Option.some("referralCode"),
      },
    });
    expect(workspace.calls).toEqual(["getAccount", "completeProfile"]);
    expect(storedAccount(workspace).kind).toBe("completion-required");
  });

  test("a completion whose account read fails keeps the draft and can't be sent twice", async () => {
    const { registry, workspace } = makeFakeCustomerData("completion-required");
    await settle(registry, accountAtom);
    const { draft } = completion("");
    registry.set(completionEditsAtom, Option.some(draft));
    workspace.fail("getAccount", "rate-limited");

    const state = await submit(registry, completeProfileAtom, {
      draft,
      invitationCode: undefined,
      phoneRegion,
    });

    expect(state._tag).toBe("Done");
    expect(storedAccount(workspace).kind).toBe("linked");
    expect(registry.get(completionEditsAtom)).toEqual(Option.some(draft));
  });

  test("each refusal is a new attempt to focus", async () => {
    const { registry } = makeFakeCustomerData("completion-required");
    await settle(registry, accountAtom);
    const empty = {
      draft: completionDraftOf(undefined),
      invitationCode: undefined,
      phoneRegion,
    };

    const first = await submit(registry, completeProfileAtom, empty);
    const second = await submit(registry, completeProfileAtom, empty);

    expect(first._tag === "Invalid" && second._tag === "Invalid").toBe(true);
    expect(
      first._tag === "Invalid" &&
        second._tag === "Invalid" &&
        first.attempt !== second.attempt
    ).toBe(true);
  });

  test("an invalid draft sends nothing", async () => {
    const { registry, workspace } = makeFakeCustomerData("completion-required");
    await settle(registry, accountAtom);

    const state = await submit(registry, completeProfileAtom, {
      draft: completionDraftOf(undefined),
      invitationCode: undefined,
      phoneRegion,
    });

    expect(state._tag).toBe("Invalid");
    expect(workspace.calls).toEqual(["getAccount"]);
  });

  test("the invitation code comes from a completion-required account only", () => {
    const { workspace } = makeFakeCustomerData("completion-required");
    expect(invitationCodeOf(storedAccount(workspace))).toBe(
      sampleInvitationCode
    );
    expect(
      invitationCodeOf(storedAccount(makeFakeCustomerData("linked").workspace))
    ).toBeUndefined();
  });
});
