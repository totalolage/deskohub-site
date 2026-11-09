import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import {
  type AsyncResult,
  type Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import type { CustomerRequestFailure } from "../../customer-api/customer-view-error";
import {
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import type { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import {
  checkPasskeyName,
  deletePasskeyAtom,
  passkeyNameMaximumLength,
  passkeyRow,
  passkeysAtom,
  passkeysReleased,
  passkeyWriteOutcome,
  renamePasskeyAtom,
} from "./passkeys";

const defaultName = "default name";

/** Runs a write atom once, as the screen does, and returns its outcome. */
const write = async <A, E extends CustomerRequestFailure, W>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Writable<AsyncResult.AsyncResult<A, E>, W>,
  value: W
) => {
  const unmount = registry.mount(atom);
  registry.set(atom, value);
  const exit = await Effect.runPromise(
    Effect.exit(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
    )
  );
  unmount();
  return passkeyWriteOutcome(exit);
};

/** The list as the screen holds it while a write runs. */
const showList = async () => {
  const fake = makeFakeCustomerData("linked");
  const unmount = fake.registry.mount(passkeysAtom);
  await settle(fake.registry, passkeysAtom);
  return { ...fake, unmount };
};

const listReads = (workspace: FakeWorkspace) =>
  workspace.calls.filter((call) => call === "listPasskeys").length;

const passkeyIds = (workspace: FakeWorkspace) =>
  workspace.data.passkeys.map((passkey) => passkey.id);

/** The linked sample account's two passkeys. */
const samplePasskeys = (workspace: FakeWorkspace) => {
  const [first, second] = workspace.data.passkeys;
  if (first === undefined || second === undefined) {
    throw new Error("The linked sample account has two passkeys");
  }
  return { first, second };
};

describe("the passkey list", () => {
  test("lists the account's passkeys without spending account reads", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");

    const result = await settle(registry, passkeysAtom);

    expect(result._tag).toBe("Success");
    expect(
      result._tag === "Success" && result.success.map(({ id }) => id)
    ).toEqual(passkeyIds(workspace));
    expect(workspace.calls).toEqual(["listPasskeys"]);
  });

  test("an account without passkeys gets the empty list", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.data = { ...workspace.data, passkeys: [] };

    expect(await settle(registry, passkeysAtom)).toMatchObject({
      _tag: "Success",
      success: [],
    });
  });

  test("is hidden while the release withholds passkeys", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.setAccount({ ...workspace.data.account, passkeys: undefined });
    const unmount = registry.mount(passkeysAtom);

    await settle(registry, passkeysAtom);

    expect(passkeysReleased(registry.get(passkeysAtom))).toBe(false);
    unmount();
  });

  test("an unavailable list stays shown as a retryable failure", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    workspace.fail("listPasskeys", "service-unavailable");
    const unmount = registry.mount(passkeysAtom);

    const result = await settle(registry, passkeysAtom);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerServiceUnavailable" },
    });
    expect(passkeysReleased(registry.get(passkeysAtom))).toBe(true);
    unmount();
  });
});

describe("a passkey row", () => {
  const createdAt = "2026-10-01T10:00:00.000Z";

  test("shows the provider when it differs from the name", () => {
    const row = passkeyRow(
      { id: "1", name: "Phone", provider: "Provider", createdAt },
      defaultName
    );
    expect(row).toMatchObject({ name: "Phone", provider: "Provider" });
    expect(Option.isSome(row.createdAt)).toBe(true);
  });

  test("leaves out a provider the name already says", () => {
    expect(
      passkeyRow(
        { id: "1", name: "Provider", provider: "Provider", createdAt },
        defaultName
      ).provider
    ).toBeUndefined();
  });

  test("gives an unnamed passkey the default name", () => {
    expect(passkeyRow({ id: "1", createdAt }, defaultName)).toMatchObject({
      name: defaultName,
      provider: undefined,
    });
    expect(
      passkeyRow({ id: "1", name: " ", createdAt }, defaultName).name
    ).toBe(defaultName);
  });

  test("an unreadable date shows no date", () => {
    expect(
      Option.isNone(
        passkeyRow({ id: "1", createdAt: "not a date" }, defaultName).createdAt
      )
    ).toBe(true);
  });
});

describe("a rename draft", () => {
  const check = (draft: string) =>
    checkPasskeyName({ draft, shownName: "Phone" })._tag;

  test("needs a name", () => {
    expect(check("")).toBe("Required");
    expect(check("   ")).toBe("Required");
  });

  test("allows at most the maximum length after trimming", () => {
    const longest = "a".repeat(passkeyNameMaximumLength);
    expect(check(longest)).toBe("Valid");
    expect(check(`  ${longest}  `)).toBe("Valid");
    expect(check(`${longest}a`)).toBe("TooLong");
  });

  test("the shown name again changes nothing", () => {
    expect(check("Phone")).toBe("Unchanged");
    expect(check(" Phone ")).toBe("Unchanged");
  });

  test("saves the trimmed name", () => {
    expect(checkPasskeyName({ draft: " Laptop ", shownName: "Phone" })).toEqual(
      { _tag: "Valid", name: "Laptop" }
    );
  });
});

describe("renaming a passkey", () => {
  test("saves the name and refreshes the list", async () => {
    const { registry, workspace, unmount } = await showList();
    const { first } = samplePasskeys(workspace);

    expect(
      await write(registry, renamePasskeyAtom, { id: first.id, name: "Laptop" })
    ).toBe("succeeded");
    expect(await settle(registry, passkeysAtom)).toMatchObject({
      _tag: "Success",
      success: [{ id: first.id, name: "Laptop" }, {}],
    });
    expect(listReads(workspace)).toBe(2);
    unmount();
  });

  test("a refused rename fails and refreshes nothing", async () => {
    const { registry, workspace, unmount } = await showList();
    workspace.fail("updatePasskey", "rate-limited");

    expect(
      await write(registry, renamePasskeyAtom, {
        id: samplePasskeys(workspace).first.id,
        name: "Laptop",
      })
    ).toBe("failed");
    expect(listReads(workspace)).toBe(1);
    unmount();
  });

  test("a too-old sign-in asks for reauthentication", async () => {
    const { registry, workspace, unmount } = await showList();
    workspace.fail("updatePasskey", "session-not-fresh");

    expect(
      await write(registry, renamePasskeyAtom, {
        id: samplePasskeys(workspace).first.id,
        name: "Laptop",
      })
    ).toBe("reauthentication-required");
    unmount();
  });

  test("a passkey removed elsewhere is gone and the list refreshes", async () => {
    const { registry, workspace, unmount } = await showList();
    const { first, second } = samplePasskeys(workspace);
    const rest = [second];
    workspace.data = { ...workspace.data, passkeys: rest };

    expect(
      await write(registry, renamePasskeyAtom, { id: first.id, name: "Laptop" })
    ).toBe("gone");
    expect(await settle(registry, passkeysAtom)).toMatchObject({
      _tag: "Success",
      success: rest.map(({ id }) => ({ id })),
    });
    expect(listReads(workspace)).toBe(2);
    unmount();
  });

  test("an unconfirmed rename refreshes the list to show what was saved", async () => {
    const { registry, workspace, unmount } = await showList();
    const { first } = samplePasskeys(workspace);
    workspace.fail("updatePasskey", "transport-failure");

    expect(
      await write(registry, renamePasskeyAtom, { id: first.id, name: "Laptop" })
    ).toBe("unconfirmed");
    expect(await settle(registry, passkeysAtom)).toMatchObject({
      success: [{ id: first.id, name: "Laptop" }, {}],
    });
    expect(listReads(workspace)).toBe(2);
    unmount();
  });
});

describe("deleting a passkey", () => {
  test("removes it and refreshes the list", async () => {
    const { registry, workspace, unmount } = await showList();
    const { first, second } = samplePasskeys(workspace);

    expect(await write(registry, deletePasskeyAtom, first.id)).toBe(
      "succeeded"
    );
    expect(await settle(registry, passkeysAtom)).toMatchObject({
      _tag: "Success",
      success: [{ id: second.id }],
    });
    expect(listReads(workspace)).toBe(2);
    unmount();
  });

  test("a failed deletion keeps the passkey", async () => {
    const { registry, workspace, unmount } = await showList();
    const ids = passkeyIds(workspace);
    workspace.fail("deletePasskey", "rate-limited");

    expect(
      await write(
        registry,
        deletePasskeyAtom,
        samplePasskeys(workspace).first.id
      )
    ).toBe("failed");
    expect(passkeyIds(workspace)).toEqual(ids);
    expect(listReads(workspace)).toBe(1);
    unmount();
  });

  test("a too-old sign-in asks for reauthentication and keeps the passkey", async () => {
    const { registry, workspace, unmount } = await showList();
    const ids = passkeyIds(workspace);
    workspace.fail("deletePasskey", "session-not-fresh");

    expect(
      await write(
        registry,
        deletePasskeyAtom,
        samplePasskeys(workspace).first.id
      )
    ).toBe("reauthentication-required");
    expect(passkeyIds(workspace)).toEqual(ids);
    unmount();
  });

  test("a passkey already removed is gone and the list refreshes", async () => {
    const { registry, workspace, unmount } = await showList();
    const { first, second } = samplePasskeys(workspace);
    const rest = [second];
    workspace.data = { ...workspace.data, passkeys: rest };

    expect(await write(registry, deletePasskeyAtom, first.id)).toBe("gone");
    expect(listReads(workspace)).toBe(2);
    unmount();
  });

  test("an unconfirmed deletion refreshes the list", async () => {
    const { registry, workspace, unmount } = await showList();
    const { first, second } = samplePasskeys(workspace);
    workspace.fail("deletePasskey", "transport-failure");

    expect(await write(registry, deletePasskeyAtom, first.id)).toBe(
      "unconfirmed"
    );
    expect(await settle(registry, passkeysAtom)).toMatchObject({
      success: [{ id: second.id }],
    });
    unmount();
  });
});
