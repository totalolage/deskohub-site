"use server";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Layer, Result } from "effect";
import { revalidatePath } from "next/cache";
import {
  accountActionError,
  requireAccountsEnabled,
  requireVerifiedSession,
} from "@/features/account/account-action-guards";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  type CustomerAvatarRejectionReason,
  CustomerAvatarService,
} from "@/features/account/backend/customer-avatar.service";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

export type CustomerAvatarView = {
  readonly url: string;
  readonly version?: number;
};

/**
 * Closed avatar mutation contract. Validation failures are typed rejection
 * reasons the client renders copy for; transient media-provider failures are
 * honestly reported as retryable instead of being claimed as done.
 */
export type CustomerAvatarMutationResult =
  | { readonly status: "uploaded"; readonly avatar: CustomerAvatarView }
  | { readonly status: "removed" }
  | {
      readonly status: "rejected";
      readonly reason: CustomerAvatarRejectionReason;
    }
  | { readonly status: "retryable" };

type AvatarUploadInput = { readonly file: File };

const avatarInputIssue = (message: string): StandardSchemaV1.Issue => ({
  message,
});

const avatarUploadInputSchema: StandardSchemaV1<unknown, AvatarUploadInput> = {
  "~standard": {
    version: 1,
    vendor: "deskohub",
    validate: (value) => {
      if (!(value instanceof FormData)) {
        return { issues: [avatarInputIssue("Expected a file upload.")] };
      }
      const file = value.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return { issues: [avatarInputIssue("Choose an image to upload.")] };
      }
      return { value: { file } };
    },
  },
};

const avatarRemoveInputSchema: StandardSchemaV1<unknown, undefined> = {
  "~standard": {
    version: 1,
    vendor: "deskohub",
    validate: () => ({ value: undefined }),
  },
};

const revalidateAccount = (locale: Locale) =>
  Effect.sync(() => revalidatePath(`/${locale}/account`));

const unavailableError = (locale: Locale) =>
  new PublicSafeActionError({
    message: m.accountUnavailableDescription({}, { locale }),
  });

/**
 * Uploads the customer avatar from the verified session only: the account
 * comes from the authoritative resolver, never from client-supplied state,
 * and the mutation is fully independent of the profile form's input.
 */
const uploadAvatarMutation = Effect.fn(
  function* (file: File, locale: Locale) {
    yield* requireAccountsEnabled(locale);
    yield* requireVerifiedSession;

    const resolution = yield* Effect.flatMap(
      CustomerAccountResolver,
      (resolver) => resolver.resolve
    ).pipe(Effect.result);
    if (Result.isFailure(resolution)) {
      return yield* Effect.fail(resolution.failure);
    }

    const buffer = yield* Effect.tryPromise({
      try: () => file.arrayBuffer(),
      catch: (cause) =>
        new PublicSafeActionError({
          message: m.accountProfileError({}, { locale }),
          cause: cause instanceof Error ? cause : undefined,
        }),
    });

    const outcome = yield* Effect.flatMap(CustomerAvatarService, (avatars) =>
      avatars.upload(resolution.success.accountId, {
        bytes: new Uint8Array(buffer),
        declaredSize: file.size,
        declaredMediaType: file.type,
      })
    ).pipe(
      Effect.map((avatar) => ({ status: "uploaded", avatar }) as const),
      Effect.catchTag("CustomerAvatarRejectedError", (error) =>
        Effect.succeed({
          status: "rejected",
          reason: error.reason,
        } as const)
      ),
      Effect.catchTag("CustomerAvatarProviderError", () =>
        Effect.succeed({ status: "retryable" } as const)
      ),
      Effect.catchTag("CustomerAvatarUnavailableError", () =>
        Effect.fail(unavailableError(locale))
      )
    );

    if (outcome.status === "uploaded") {
      yield* revalidateAccount(locale);
    }
    return outcome;
  },
  (effect, _file, locale) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof PublicSafeActionError
          ? error
          : accountActionError(locale)(error)
      ),
      Effect.provide(
        Layer.mergeAll(
          CustomerAuthentication.Default,
          CustomerAccountResolver.Live,
          CustomerAvatarService.Live
        )
      )
    )
);

const removeAvatarMutation = Effect.fn(
  function* (_input: undefined, locale: Locale) {
    yield* requireAccountsEnabled(locale);
    yield* requireVerifiedSession;

    const resolution = yield* Effect.flatMap(
      CustomerAccountResolver,
      (resolver) => resolver.resolve
    ).pipe(Effect.result);
    if (Result.isFailure(resolution)) {
      return yield* Effect.fail(resolution.failure);
    }

    const outcome = yield* Effect.flatMap(CustomerAvatarService, (avatars) =>
      avatars.remove(resolution.success.accountId)
    ).pipe(
      Effect.map(() => ({ status: "removed" }) as const),
      Effect.catchTag("CustomerAvatarProviderError", () =>
        Effect.succeed({ status: "retryable" } as const)
      ),
      Effect.catchTag("CustomerAvatarUnavailableError", () =>
        Effect.fail(unavailableError(locale))
      )
    );

    if (outcome.status === "removed") {
      yield* revalidateAccount(locale);
    }
    return outcome;
  },
  (effect, _input, locale) =>
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof PublicSafeActionError
          ? error
          : accountActionError(locale)(error)
      ),
      Effect.provide(
        Layer.mergeAll(
          CustomerAuthentication.Default,
          CustomerAccountResolver.Live,
          CustomerAvatarService.Live
        )
      )
    )
);

const uploadCustomerAvatarAction = defineWorkspaceAction(
  {
    operation: "account.upload-avatar",
    schema: avatarUploadInputSchema,
    logInput: false,
  },
  (input, { locale }) => uploadAvatarMutation(input.file, locale)
);

const removeCustomerAvatarAction = defineWorkspaceAction(
  {
    operation: "account.remove-avatar",
    schema: avatarRemoveInputSchema,
    logInput: false,
  },
  (input, { locale }) => removeAvatarMutation(input, locale)
);

export const uploadCustomerAvatar: typeof uploadCustomerAvatarAction = async (
  ...args: Parameters<typeof uploadCustomerAvatarAction>
) => {
  "use server";
  return await uploadCustomerAvatarAction(...args);
};

export const removeCustomerAvatar: typeof removeCustomerAvatarAction = async (
  ...args: Parameters<typeof removeCustomerAvatarAction>
) => {
  "use server";
  return await removeCustomerAvatarAction(...args);
};
