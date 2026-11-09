import { describe, expect, test } from "bun:test";
import type { CustomerAvatarRejectionReason } from "@deskohub/workspace-customer-api";
import { Effect, Layer, Option } from "effect";
import {
  type AsyncResult,
  type Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import { accountAtom } from "../../../customer-api/customer-data-runtime";
import {
  DeviceCapabilityFailed,
  ImageLibrary,
  type PickedImage,
} from "../../../customer-api/device-capabilities";
import {
  makeCustomerDataRegistry,
  makeFakeCustomerData,
  settle,
} from "../../../customer-api/testing/customer-data-test-registry";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../../customer-api/testing/fake-workspace";
import {
  type AvatarAction,
  AvatarFeedback,
  avatarActionAtom,
  avatarFeedback,
  isAvatarBusy,
} from "./avatar-action";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP4f5CdJMQwqmFUw/DVAADb58cQQtPrLAAAAABJRU5ErkJggg==";
const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));

const pickedPng = (overrides: Partial<PickedImage> = {}): PickedImage => ({
  uri: `data:image/png;base64,${pngBase64}`,
  name: "sample.png",
  mimeType: "image/png",
  size: pngBytes.length,
  ...overrides,
});

const waitFor = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
) =>
  Effect.runPromise(
    Effect.result(
      AtomRegistry.getResult(atom, { suspendOnWaiting: true })(registry)
    )
  );

/** Runs one avatar action to its end and returns the section's feedback. */
const act = async (
  registry: AtomRegistry.AtomRegistry,
  action: AvatarAction
) => {
  registry.mount(avatarActionAtom);
  registry.set(avatarActionAtom, action);
  await waitFor(registry, avatarActionAtom);
  return avatarFeedback(registry.get(avatarActionAtom));
};

const withAvatar = (workspace: FakeWorkspace) => {
  const { account } = workspace.data;
  if (account.kind !== "linked") throw new Error("expected a linked account");
  workspace.setAccount({
    ...account,
    avatar: {
      kind: "available",
      avatar: { url: "https://cdn.example/avatar.png", version: 1 },
    },
  });
  return workspace;
};

const withAvatarsHidden = (workspace: FakeWorkspace) => {
  const { account } = workspace.data;
  if (account.kind !== "linked") throw new Error("expected a linked account");
  workspace.setAccount({ ...account, avatar: { kind: "hidden" } });
  return workspace;
};

describe("changing the avatar", () => {
  test("uploads the picked image as one file part and refreshes the account", async () => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    device.pickedImage = Option.some(pickedPng());
    registry.mount(accountAtom);
    await settle(registry, accountAtom);

    const feedback = await act(registry, "change");
    const account = await settle(registry, accountAtom);

    expect(feedback).toEqual(AvatarFeedback.Updated());
    expect(workspace.calls).toEqual([
      "getAccount",
      "uploadAvatar",
      "getAccount",
    ]);
    expect(workspace.avatarUploads).toHaveLength(1);
    const [parts] = workspace.avatarUploads;
    expect(parts).toHaveLength(1);
    expect(parts?.[0]).toMatchObject({
      _tag: "File",
      field: "file",
      name: "sample.png",
      contentType: "image/png",
    });
    expect(parts?.[0]?._tag === "File" && [...parts[0].bytes]).toEqual([
      ...pngBytes,
    ]);
    expect(account).toMatchObject({
      success: {
        avatar: { kind: "available", avatar: { url: expect.any(String) } },
      },
    });
  });

  test("a cancelled pick sends nothing and shows nothing", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");

    const feedback = await act(registry, "change");

    expect(feedback).toEqual(AvatarFeedback.Idle());
    expect(isAvatarBusy(feedback)).toBe(false);
    expect(workspace.calls).toEqual([]);
  });

  test.each([
    [{ mimeType: "image/gif" }, "unsupported-format"],
    [{ size: 2 * 1024 * 1024 + 1 }, "file-too-large"],
  ] as const)("refuses %o before uploading", async (overrides, reason) => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    device.pickedImage = Option.some(pickedPng(overrides));

    const feedback = await act(registry, "change");

    expect(feedback).toEqual(AvatarFeedback.Rejected({ reason }));
    expect(workspace.calls).toEqual([]);
  });

  test.each<CustomerAvatarRejectionReason>([
    "file-missing",
    "file-too-large",
    "unsupported-format",
    "undecodable-image",
    "image-dimensions-too-large",
  ])("shows the Workspace's %s refusal as its own reason", async (reason) => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    device.pickedImage = Option.some(pickedPng());
    workspace.rejectNextAvatar(reason);

    const feedback = await act(registry, "change");

    expect(feedback).toEqual(AvatarFeedback.Rejected({ reason }));
    expect(workspace.calls).toEqual(["uploadAvatar"]);
  });

  test("hides the section when the release withholds avatars", async () => {
    const { registry, workspace, device } = makeFakeCustomerData(
      "linked",
      withAvatarsHidden(FakeWorkspace.forKind("linked"))
    );
    device.pickedImage = Option.some(pickedPng());

    const feedback = await act(registry, "change");

    expect(feedback).toEqual(AvatarFeedback.Withheld());
    expect(workspace.avatarUploads).toEqual([]);
  });

  test("reads the account again when it no longer has a usable profile", async () => {
    const { registry, workspace, device } = makeFakeCustomerData(
      "linked",
      FakeWorkspace.forKind("support-required")
    );
    device.pickedImage = Option.some(pickedPng());
    registry.mount(accountAtom);
    await settle(registry, accountAtom);

    const feedback = await act(registry, "change");
    await settle(registry, accountAtom);

    expect(feedback).toMatchObject({
      _tag: "Failed",
      error: { _tag: "LinkRequired", reason: "support-required" },
    });
    expect(workspace.calls).toEqual([
      "getAccount",
      "uploadAvatar",
      "getAccount",
    ]);
  });

  test("an upload whose answer was lost is unconfirmed and refreshes the account", async () => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    device.pickedImage = Option.some(pickedPng());
    workspace.fail("uploadAvatar", "transport-failure");
    registry.mount(accountAtom);
    await settle(registry, accountAtom);

    const feedback = await act(registry, "change");
    const account = await settle(registry, accountAtom);

    expect(feedback).toMatchObject({
      _tag: "Failed",
      error: { _tag: "Unconfirmed" },
    });
    expect(workspace.calls).toEqual([
      "getAccount",
      "uploadAvatar",
      "getAccount",
    ]);
    expect(account).toMatchObject({
      success: { avatar: { avatar: { url: expect.any(String) } } },
    });
  });

  test("a refused request leaves the account alone", async () => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    device.pickedImage = Option.some(pickedPng());
    workspace.fail("uploadAvatar", "service-unavailable");
    registry.mount(accountAtom);
    await settle(registry, accountAtom);

    const feedback = await act(registry, "change");

    expect(feedback).toMatchObject({
      _tag: "Failed",
      error: { _tag: "Unavailable" },
    });
    expect(workspace.calls).toEqual(["getAccount", "uploadAvatar"]);
  });

  test("an unreadable picked file fails before anything is sent", async () => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    device.pickedImage = Option.some(
      pickedPng({ uri: "file:///nonexistent/deskohub-avatar.png" })
    );

    const feedback = await act(registry, "change");

    expect(feedback).toEqual(AvatarFeedback.FileUnreadable());
    expect(workspace.calls).toEqual([]);
  });

  test("a picker that fails to open says so", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    const registry = makeCustomerDataRegistry(
      Layer.merge(
        fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
        Layer.succeed(ImageLibrary, {
          pickImage: Effect.fail(
            new DeviceCapabilityFailed({ capability: "image-library" })
          ),
        })
      )
    );

    const feedback = await act(registry, "change");

    expect(feedback).toEqual(AvatarFeedback.PickerFailed());
    expect(workspace.calls).toEqual([]);
  });
});

describe("removing the avatar", () => {
  test("removes it and refreshes the account", async () => {
    const { registry, workspace } = makeFakeCustomerData(
      "linked",
      withAvatar(FakeWorkspace.forKind("linked"))
    );
    registry.mount(accountAtom);
    await settle(registry, accountAtom);

    const feedback = await act(registry, "remove");
    const account = await settle(registry, accountAtom);

    expect(feedback).toEqual(AvatarFeedback.Removed());
    expect(workspace.calls).toEqual([
      "getAccount",
      "removeAvatar",
      "getAccount",
    ]);
    expect(account).toMatchObject({
      success: { avatar: { kind: "available", avatar: null } },
    });
  });

  test("a failed removal keeps the avatar", async () => {
    const { registry, workspace } = makeFakeCustomerData(
      "linked",
      withAvatar(FakeWorkspace.forKind("linked"))
    );
    workspace.fail("removeAvatar", "service-unavailable");

    const feedback = await act(registry, "remove");

    expect(feedback).toMatchObject({ _tag: "Failed" });
    expect(workspace.data.account).toMatchObject({
      avatar: { avatar: { version: 1 } },
    });
  });

  test("hides the section when the release withholds avatars", async () => {
    const { registry } = makeFakeCustomerData(
      "linked",
      withAvatarsHidden(FakeWorkspace.forKind("linked"))
    );

    expect(await act(registry, "remove")).toEqual(AvatarFeedback.Withheld());
  });
});

describe("while an action runs", () => {
  test("the controls wait and the upload announces itself", async () => {
    const { registry, workspace, device } = makeFakeCustomerData("linked");
    device.pickedImage = Option.some(pickedPng());
    workspace.fail("uploadAvatar", "hang");
    registry.mount(avatarActionAtom);

    registry.set(avatarActionAtom, "change");
    await Bun.sleep(50);
    const feedback = avatarFeedback(registry.get(avatarActionAtom));

    expect(feedback).toEqual(AvatarFeedback.Uploading());
    expect(isAvatarBusy(feedback)).toBe(true);
  });

  test("the controls wait, silently, while the picker is open", async () => {
    const workspace = FakeWorkspace.forKind("linked");
    const registry = makeCustomerDataRegistry(
      Layer.merge(
        fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
        Layer.succeed(ImageLibrary, { pickImage: Effect.never })
      )
    );
    registry.mount(avatarActionAtom);

    registry.set(avatarActionAtom, "change");
    await Bun.sleep(50);
    const feedback = avatarFeedback(registry.get(avatarActionAtom));

    expect(feedback).toEqual(AvatarFeedback.Picking());
    expect(isAvatarBusy(feedback)).toBe(true);
    expect(workspace.calls).toEqual([]);
  });

  test("the controls wait while the avatar is removed", async () => {
    const { registry, workspace } = makeFakeCustomerData(
      "linked",
      withAvatar(FakeWorkspace.forKind("linked"))
    );
    workspace.fail("removeAvatar", "hang");
    registry.mount(avatarActionAtom);

    registry.set(avatarActionAtom, "remove");
    await Bun.sleep(50);
    const feedback = avatarFeedback(registry.get(avatarActionAtom));

    expect(feedback).toEqual(AvatarFeedback.Removing());
    expect(isAvatarBusy(feedback)).toBe(true);
  });
});
