import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { CustomerApi, CustomerAuthApi } from "../customer-api.service";
import { fakeCustomerApiLayer } from "./fake-customer-data";
import { FakeWorkspace } from "./fake-workspace";

const refusal = (
  workspace: FakeWorkspace,
  request: (auth: CustomerAuthApi["Service"]) => Effect.Effect<unknown, unknown>
) =>
  Effect.runPromise(
    Effect.flatMap(Effect.service(CustomerAuthApi), request).pipe(
      Effect.flip,
      Effect.provide(fakeCustomerApiLayer(workspace))
    )
  );

const accountRequest = (
  workspace: FakeWorkspace,
  request: (api: CustomerApi["Service"]) => Effect.Effect<unknown, unknown>
) =>
  Effect.runPromise(
    Effect.flatMap(Effect.service(CustomerApi), request).pipe(
      Effect.result,
      Effect.provide(fakeCustomerApiLayer(workspace))
    )
  );

const storedPhone = (workspace: FakeWorkspace) =>
  "profile" in workspace.data.account
    ? workspace.data.account.profile.phone
    : undefined;

// The Workspace decodes each profile payload through the shared save schemas
// before it stores the profile, so the fake stores what the Workspace would.
describe("the fake Workspace's profile endpoints", () => {
  test("store an entered phone as its phone number, as the Workspace does", async () => {
    const workspace = FakeWorkspace.forKind("linked");

    const result = await accountRequest(workspace, (api) =>
      api.account.updateProfile({
        payload: { firstName: "Alex", phone: "601 123 456" },
      })
    );

    expect(result._tag).toBe("Success");
    expect(storedPhone(workspace)).toBe("+420601123456");
  });

  test("store a blank phone as cleared, as the Workspace does", async () => {
    const workspace = FakeWorkspace.forKind("linked");

    const result = await accountRequest(workspace, (api) =>
      api.account.updateProfile({ payload: { firstName: "Alex", phone: "" } })
    );

    expect(result._tag).toBe("Success");
    expect(storedPhone(workspace)).toBeNull();
  });

  test("store a completion's entered phone as its phone number", async () => {
    const workspace = FakeWorkspace.forKind("completion-required");

    const result = await accountRequest(workspace, (api) =>
      api.account.completeProfile({
        headers: {},
        payload: { firstName: "Jordan", phone: "601 123 456" },
      })
    );

    expect(result._tag).toBe("Success");
    expect(workspace.data.account.kind).toBe("linked");
    expect(storedPhone(workspace)).toBe("+420601123456");
  });

  test("refuse a phone without a phone number before saving, as the Workspace's payload check does", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    const before = workspace.data.account;

    const result = await accountRequest(workspace, (api) =>
      api.account.updateProfile({
        payload: { firstName: "Alex", phone: "not a phone" },
      })
    );

    expect(result._tag).toBe("Failure");
    expect(workspace.data.account).toBe(before);
  });
});

const sessionLocale = (workspace: FakeWorkspace) =>
  Effect.runPromise(
    Effect.flatMap(Effect.service(CustomerAuthApi), (auth) =>
      auth.auth.getSession()
    ).pipe(Effect.provide(fakeCustomerApiLayer(workspace)))
  ).then((session) => session?.user.locale);

// The Workspace saves the language on any signed-in account, Dotypos
// profile or not, and refuses while its deletion is pending.
describe("the fake Workspace's locale endpoint", () => {
  test("saves an account's language without a profile, and later account and session reads return it", async () => {
    const workspace = FakeWorkspace.forKind("completion-required");

    const saved = await accountRequest(workspace, (api) =>
      api.account.updateLocale({ payload: { locale: "de-DE" } })
    );
    const account = await accountRequest(workspace, (api) =>
      api.account.getAccount({ headers: {} })
    );

    expect(saved).toMatchObject({ success: { locale: "de-DE" } });
    expect(account).toMatchObject({
      success: { kind: "completion-required", locale: "de-DE" },
    });
    expect(await sessionLocale(workspace)).toBe("de-DE");
  });

  test("keeps the saved language through profile completion", async () => {
    const workspace = FakeWorkspace.forKind("completion-required");

    await accountRequest(workspace, (api) =>
      api.account.updateLocale({ payload: { locale: "sk-SK" } })
    );
    await accountRequest(workspace, (api) =>
      api.account.completeProfile({
        headers: {},
        payload: { firstName: "Jordan" },
      })
    );

    expect(workspace.data.account).toMatchObject({
      kind: "linked",
      locale: "sk-SK",
    });
  });

  test("refuses while deletion is pending, without saving", async () => {
    const workspace = FakeWorkspace.forKind("deletion-pending");
    const before = workspace.data.account;

    const result = await accountRequest(workspace, (api) =>
      api.account.updateLocale({ payload: { locale: "de-DE" } })
    );

    expect(result).toMatchObject({
      failure: {
        _tag: "CustomerAccountLinkRequired",
        reason: "deletion-pending",
      },
    });
    expect(workspace.data.account).toBe(before);
  });
});

describe("the fake Workspace's Better Auth passkey endpoints", () => {
  test("refuse renaming an unknown passkey as Better Auth does", async () => {
    const workspace = FakeWorkspace.forKind("linked");

    expect(
      await refusal(workspace, (auth) =>
        auth.auth.updatePasskey({ payload: { id: "unknown", name: "Name" } })
      )
    ).toMatchObject({
      _tag: "CustomerAuthRejected",
      reason: "not-found",
      code: "PASSKEY_NOT_FOUND",
    });
  });

  test("refuse deleting an unknown passkey as Better Auth does", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    const passkeys = workspace.data.passkeys;

    expect(
      await refusal(workspace, (auth) =>
        auth.auth.deletePasskey({ payload: { id: "unknown" } })
      )
    ).toMatchObject({
      _tag: "CustomerAuthRejected",
      reason: "not-found",
      code: "PASSKEY_NOT_FOUND",
    });
    expect(workspace.data.passkeys).toEqual(passkeys);
  });
});

describe("the fake Workspace's Better Auth consent endpoint", () => {
  test("refuses disconnecting an unknown assistant as Better Auth does", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    const assistants = workspace.data.assistants;

    expect(
      await refusal(workspace, (auth) =>
        auth.auth.deleteConsent({ payload: { id: "unknown" } })
      )
    ).toMatchObject({
      _tag: "CustomerAuthRejected",
      reason: "not-found",
      code: "not_found",
    });
    expect(workspace.data.assistants).toEqual(assistants);
  });
});
