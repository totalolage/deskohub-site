import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { m } from "@/features/i18n";
import { mockWorkspaceActionRequest } from "@/shared/testing/workspace-action-request.test-utils";
import { AccountAvatarReleaseGate } from "./backend/account-release-gates";
import { CustomerAccountAccessError } from "./customer-account";

const revalidatePath = mock(
  (_path: string, _type?: "layout" | "page") => undefined
);
mock.module("next/cache", () => ({ revalidatePath }));

await mockWorkspaceActionRequest();

// The avatar release gate over a fake flag evaluation.
let avatarFlag: Effect.Effect<boolean, PostHogFeatureFlagEvaluationError> =
  Effect.succeed(true);
const readAvatarFlag = mock(() => avatarFlag);
Object.assign(AccountAvatarReleaseGate, {
  Live: AccountAvatarReleaseGate.Default.pipe(
    Layer.provide(
      WorkspaceFeatureFlagServiceMock({
        isEnabled: () => Effect.suspend(readAvatarFlag),
      })
    )
  ),
});

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

let avatarLive: Layer.Layer<Avatar, unknown> = AvatarLayer;
Object.defineProperty(Avatar, "Live", { get: () => avatarLive });

/** A media service whose construction fails, as with invalid configuration. */
const UnconfiguredAvatarLayer = Layer.effect(
  Avatar,
  Effect.fail({ _tag: "CloudinaryConfigError" })
) as Layer.Layer<Avatar, unknown>;

const activeSession = {
  accountId: "@test/account-id" as const,
  email: testEmailAddress("ada"),
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
    readAvatarFlag.mockClear();
    avatarLive = AvatarLayer;
    avatarFlag = Effect.succeed(true);
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
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account", "layout");
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
    expect(readAvatarFlag).not.toHaveBeenCalled();
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

  test("rejects direct upload and removal before resolution or media work when avatars are disabled", async () => {
    avatarFlag = Effect.succeed(false);
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

    const unavailableMessage = m.accountUnavailableDescription(
      {},
      { locale: "en-US" }
    );
    expect(uploadResult.serverError).toBe(unavailableMessage);
    expect(removeResult.serverError).toBe(unavailableMessage);
    expect(readAvatarFlag).toHaveBeenCalledTimes(2);
    expect(resolverCalls).toBe(0);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(uploadCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("treats avatar capability evaluation failure as the same safe unavailable response", async () => {
    avatarFlag = Effect.fail(
      new PostHogFeatureFlagEvaluationError({
        message: "Could not evaluate the PostHog feature flag.",
        cause: new Error("flag unavailable"),
      })
    );
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

    const unavailableMessage = m.accountUnavailableDescription(
      {},
      { locale: "en-US" }
    );
    expect(uploadResult.serverError).toBe(unavailableMessage);
    expect(removeResult.serverError).toBe(unavailableMessage);
    expect(resolverCalls).toBe(0);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(uploadCalls).toHaveLength(0);
    expect(removeCalls).toHaveLength(0);
  });

  test("reports an unconfigured media service as unavailable once the mutation is admitted", async () => {
    avatarLive = UnconfiguredAvatarLayer;
    const { uploadCustomerAvatar, removeCustomerAvatar } =
      await importActions();

    const uploadResult = await uploadCustomerAvatar(uploadForm());
    const removeResult = await removeCustomerAvatar();

    const unavailableMessage = m.accountUnavailableDescription(
      {},
      { locale: "en-US" }
    );
    expect(uploadResult.serverError).toBe(unavailableMessage);
    expect(removeResult.serverError).toBe(unavailableMessage);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("refuses a missing session before building the media service", async () => {
    avatarLive = UnconfiguredAvatarLayer;
    currentUser = Effect.succeed(null);
    const { uploadCustomerAvatar, removeCustomerAvatar } =
      await importActions();

    const uploadResult = await uploadCustomerAvatar(uploadForm());
    const removeResult = await removeCustomerAvatar();

    const sessionExpiredMessage = m.accountSessionExpired(
      {},
      { locale: "en-US" }
    );
    expect(uploadResult.serverError).toBe(sessionExpiredMessage);
    expect(removeResult.serverError).toBe(sessionExpiredMessage);
  });

  test("removes the avatar and revalidates the account path", async () => {
    const { removeCustomerAvatar } = await importActions();

    const result = await removeCustomerAvatar();

    expect(result).toEqual({ data: { status: "removed" } });
    expect(removeCalls).toEqual(["@test/account-id"]);
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account", "layout");
  });

  test("reports an uncertain removal as retryable", async () => {
    removeOutcome = { status: "retryable" };
    const { removeCustomerAvatar } = await importActions();

    const result = await removeCustomerAvatar();

    expect(result).toEqual({ data: { status: "retryable" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
