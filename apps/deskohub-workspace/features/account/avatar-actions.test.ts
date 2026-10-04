import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { CustomerAccountAccessError } from "./customer-account";

const revalidatePath = mock((_path: string) => undefined);
mock.module("next/cache", () => ({ revalidatePath }));

const requestHeaders = new Headers({ referer: "https://deskohub.test/en-US" });
mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ getAll: () => [] }),
}));
mock.module("next/server", () => ({
  after: () => undefined,
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));
mock.module("botid/server", () => ({
  checkBotId: () => Promise.resolve({ isBot: false }),
}));

const areAccountsEnabled = mock(() => Promise.resolve(true));
const areAccountAvatarsEnabled = mock(() => Promise.resolve(true));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountsEnabled,
  areAccountAvatarsEnabled,
}));

let currentUser: Effect.Effect<
  {
    readonly accountId: "@test/account-id";
    readonly email: string;
    readonly deletionRequested: boolean;
  } | null,
  unknown
>;
const Authentication = Context.Service<
  Authentication,
  {
    readonly currentUser: Effect.Effect<
      {
        readonly accountId: "@test/account-id";
        readonly email: string;
        readonly deletionRequested: boolean;
      } | null,
      unknown
    >;
  }
>()("@test/AvatarActionsAuthentication");
Object.assign(Authentication, {
  Default: Layer.effect(
    Authentication,
    Effect.succeed({
      get currentUser() {
        return currentUser;
      },
    })
  ),
});
mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({ CustomerAuthentication: Authentication })
);

type Resolution =
  | {
      readonly accountId: "@test/account-id";
      readonly dotyposCustomerId: string;
    }
  | { readonly reason: string; readonly linkReason?: string };

let resolve: Effect.Effect<
  Extract<Resolution, { accountId: string }>,
  Extract<Resolution, { reason: string }>
>;
let resolverCalls = 0;
const Resolver = Context.Service<
  Resolver,
  { readonly resolve: typeof resolve }
>()("@test/AvatarActionsResolver");
Object.assign(Resolver, {
  Live: Layer.succeed(Resolver, {
    get resolve() {
      resolverCalls += 1;
      return resolve;
    },
  }),
});
mock.module(
  "@/features/account/backend/customer-account-resolver.service",
  () => ({ CustomerAccountResolver: Resolver })
);

type AvatarUploadInput = {
  readonly accountId: string;
  readonly bytes: Uint8Array;
  readonly declaredSize: number;
  readonly declaredMediaType: string;
};

type UploadOutcome =
  | {
      readonly status: "uploaded";
      readonly avatar: { url: string; version?: number };
    }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "retryable" };

let uploadCalls: AvatarUploadInput[] = [];
let uploadAccountIds: string[] = [];
let removeCalls: string[] = [];
let uploadOutcome: UploadOutcome = {
  status: "uploaded",
  avatar: {
    url: "https://res.cloudinary.test/upload/v99/avatars/x",
    version: 99,
  },
};
let removeOutcome: { status: "retryable" } | { status: "removed" } = {
  status: "removed",
};
const Avatar = Context.Service<Avatar, Record<string, never>>()(
  "@test/AvatarActionsAvatar"
);

const AvatarLayer = Layer.succeed(Avatar, {
  upload: (accountId: string, input: AvatarUploadInput) =>
    Effect.suspend(() => {
      uploadCalls.push(input);
      uploadAccountIds.push(accountId);
      if (uploadOutcome.status === "uploaded") {
        return Effect.succeed(uploadOutcome.avatar);
      }
      if (uploadOutcome.status === "rejected") {
        return Effect.fail({
          _tag: "CustomerAvatarRejectedError",
          reason: uploadOutcome.reason,
        });
      }
      return Effect.fail({ _tag: "CustomerAvatarProviderError" });
    }) as never,
  remove: (accountId: string) =>
    Effect.suspend(() => {
      removeCalls.push(accountId);
      return removeOutcome.status === "removed"
        ? Effect.succeed(undefined)
        : Effect.fail({ _tag: "CustomerAvatarProviderError" });
    }) as never,
});

mock.module("@/features/account/backend/customer-avatar.service", () => ({
  CustomerAvatarService: Avatar,
}));

Object.assign(Avatar, { Live: AvatarLayer });

const activeSession = {
  accountId: "@test/account-id" as const,
  email: "ada@example.test",
  deletionRequested: false,
};

const pngBytes = () =>
  Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const uploadForm = () => {
  const form = new FormData();
  form.set("file", new File([pngBytes()], "avatar.png", { type: "image/png" }));
  return form;
};

describe("customer avatar actions", () => {
  beforeEach(() => {
    uploadCalls = [];
    uploadAccountIds = [];
    removeCalls = [];
    uploadOutcome = {
      status: "uploaded",
      avatar: {
        url: "https://res.cloudinary.test/upload/v99/avatars/x",
        version: 99,
      },
    };
    removeOutcome = { status: "removed" };
    revalidatePath.mockClear();
    areAccountsEnabled.mockReset();
    areAccountsEnabled.mockResolvedValue(true);
    areAccountAvatarsEnabled.mockReset();
    areAccountAvatarsEnabled.mockResolvedValue(true);
    currentUser = Effect.succeed(activeSession);
    resolverCalls = 0;
    resolve = Effect.succeed({
      accountId: "@test/account-id",
      dotyposCustomerId: "60111",
    });
  });

  const importActions = () => import("./avatar-actions");

  test("uploads from the resolved session account and revalidates the account path", async () => {
    const { uploadCustomerAvatar } = await importActions();
    const form = uploadForm();
    form.set("accountId", "attacker-selected-account");
    form.set("avatarUrl", "https://attacker.example/avatar.webp");

    const result = await uploadCustomerAvatar(form);

    expect(result).toEqual({
      data: {
        status: "uploaded",
        avatar: {
          url: "https://res.cloudinary.test/upload/v99/avatars/x",
          version: 99,
        },
      },
    });
    expect(uploadCalls).toHaveLength(1);
    expect(uploadAccountIds).toEqual(["@test/account-id"]);
    expect(uploadCalls[0]!.bytes.byteLength).toBe(pngBytes().byteLength);
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account");
  });

  test("rejects a missing or non-File upload without reaching the service", async () => {
    const { uploadCustomerAvatar } = await importActions();

    const emptyForm = new FormData();
    const missing = await uploadCustomerAvatar(emptyForm);
    expect(missing.validationErrors).toBeTruthy();
    expect(uploadCalls).toHaveLength(0);

    const wrongField = new FormData();
    wrongField.set("other", "value");
    const absent = await uploadCustomerAvatar(wrongField);
    expect(absent.validationErrors).toBeTruthy();
    expect(uploadCalls).toHaveLength(0);
  });

  test("reports a typed rejection from the service without an action error", async () => {
    uploadOutcome = { status: "rejected", reason: "file-too-large" };
    const { uploadCustomerAvatar } = await importActions();

    const result = await uploadCustomerAvatar(uploadForm());

    expect(result).toEqual({
      data: { status: "rejected", reason: "file-too-large" },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("reports a retryable provider failure honestly instead of success", async () => {
    uploadOutcome = { status: "retryable" };
    const { uploadCustomerAvatar } = await importActions();

    const result = await uploadCustomerAvatar(uploadForm());

    expect(result).toEqual({ data: { status: "retryable" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("fails with a public-safe error when the session is missing and never calls the provider", async () => {
    currentUser = Effect.succeed(null);
    const { uploadCustomerAvatar, removeCustomerAvatar } =
      await importActions();

    const uploadResult = await uploadCustomerAvatar(uploadForm());
    const removeResult = await removeCustomerAvatar();

    expect(uploadResult.serverError).toBe(
      "Your session has expired. Please sign in again."
    );
    expect(removeResult.serverError).toBe(
      "Your session has expired. Please sign in again."
    );
    expect(areAccountAvatarsEnabled).not.toHaveBeenCalled();
    expect(uploadCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
  });

  test("blocks upload and removal with the deletion-pending error when the resolver reports the marker", async () => {
    resolve = Effect.fail(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "deletion-requested",
      })
    );
    const { uploadCustomerAvatar, removeCustomerAvatar } =
      await importActions();

    const uploadResult = await uploadCustomerAvatar(uploadForm());
    const removeResult = await removeCustomerAvatar();

    expect(uploadResult.serverError).toBe(
      "Your account is already being deleted, so the profile cannot be changed."
    );
    expect(removeResult.serverError).toBe(
      "Your account is already being deleted, so the profile cannot be changed."
    );
    expect(uploadCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("blocks avatar mutations when accounts are disabled", async () => {
    areAccountsEnabled.mockResolvedValue(false);
    const { uploadCustomerAvatar, removeCustomerAvatar } =
      await importActions();

    const uploadResult = await uploadCustomerAvatar(uploadForm());
    const removeResult = await removeCustomerAvatar();

    expect(uploadResult.serverError).toBeTruthy();
    expect(removeResult.serverError).toBeTruthy();
    expect(areAccountAvatarsEnabled).not.toHaveBeenCalled();
    expect(uploadCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
  });

  test("rejects direct upload and removal before resolution or media work when avatars are disabled", async () => {
    areAccountAvatarsEnabled.mockResolvedValue(false);
    const form = uploadForm();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Missing test upload file");
    const arrayBuffer = mock(() => Promise.resolve(new ArrayBuffer(0)));
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: arrayBuffer,
    });
    const { uploadCustomerAvatar, removeCustomerAvatar } =
      await importActions();

    const uploadResult = await uploadCustomerAvatar(form);
    const removeResult = await removeCustomerAvatar();

    const unavailableMessage =
      "We cannot reach your account right now. Reservations can still be made without an account.";
    expect(uploadResult.serverError).toBe(unavailableMessage);
    expect(removeResult.serverError).toBe(unavailableMessage);
    expect(areAccountsEnabled).toHaveBeenCalledTimes(2);
    expect(areAccountAvatarsEnabled).toHaveBeenCalledTimes(2);
    expect(resolverCalls).toBe(0);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(uploadCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("treats avatar capability evaluation failure as the same safe unavailable response", async () => {
    areAccountAvatarsEnabled.mockRejectedValue(new Error("flag unavailable"));
    const form = uploadForm();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Missing test upload file");
    const arrayBuffer = mock(() => Promise.resolve(new ArrayBuffer(0)));
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: arrayBuffer,
    });
    const { uploadCustomerAvatar, removeCustomerAvatar } =
      await importActions();

    const uploadResult = await uploadCustomerAvatar(form);
    const removeResult = await removeCustomerAvatar();

    const unavailableMessage =
      "We cannot reach your account right now. Reservations can still be made without an account.";
    expect(uploadResult.serverError).toBe(unavailableMessage);
    expect(removeResult.serverError).toBe(unavailableMessage);
    expect(resolverCalls).toBe(0);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(uploadCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
  });

  test("removes the avatar and revalidates the account path", async () => {
    const { removeCustomerAvatar } = await importActions();

    const result = await removeCustomerAvatar();

    expect(result).toEqual({ data: { status: "removed" } });
    expect(removeCalls).toEqual(["@test/account-id"]);
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account");
  });

  test("reports an uncertain removal as retryable", async () => {
    removeOutcome = { status: "retryable" };
    const { removeCustomerAvatar } = await importActions();

    const result = await removeCustomerAvatar();

    expect(result).toEqual({ data: { status: "retryable" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("keeps avatar mutations independent from the profile form state", async () => {
    const { uploadCustomerAvatar } = await importActions();

    const form = uploadForm();
    form.set("firstName", "Sneaky");
    await uploadCustomerAvatar(form);

    expect(uploadCalls).toHaveLength(1);
    expect(Object.fromEntries(form.entries())).toHaveProperty("firstName");
  });
});
