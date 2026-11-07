"use server";

import type { CloudinaryConfigError } from "@deskohub/cloudinary";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Layer, type Schema } from "effect";
import { revalidatePath } from "next/cache";
import { accountActionError } from "@/features/account/account-action-guards";
import { AccountFeatureWithheldError } from "@/features/account/backend/account-feature-withheld";
import { AccountAvatarReleaseGate } from "@/features/account/backend/account-release-gates";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  CustomerAvatarService,
  type CustomerAvatarUnavailableError,
} from "@/features/account/backend/customer-avatar.service";
import {
  admitCurrentAvatarMutation,
  removeAccountAvatar,
  uploadAccountAvatar,
} from "@/features/account/backend/customer-avatar-mutations";
import { CustomerAccountAccessError } from "@/features/account/customer-account";
import { getAccountPath } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";

export type {
  CustomerAvatarMutationResult,
  CustomerAvatarView,
} from "@/features/account/backend/customer-avatar-mutations";

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
  Effect.sync(() => revalidatePath(getAccountPath(locale), "layout"));

const unavailableError = (locale: Locale) =>
  new PublicSafeActionError({
    message: m.accountUnavailableDescription({}, { locale }),
  });

type AvatarActionError =
  | AccountFeatureWithheldError
  | CloudinaryConfigError
  | CustomerAccountAccessError
  | CustomerAvatarUnavailableError
  | PublicSafeActionError
  | Schema.SchemaError;

const mapAvatarActionError =
  (locale: Locale) =>
  (error: AvatarActionError): PublicSafeActionError => {
    if (error instanceof PublicSafeActionError) return error;
    if (
      error instanceof CustomerAccountAccessError ||
      error instanceof AccountFeatureWithheldError
    ) {
      return accountActionError(locale)(error);
    }
    return unavailableError(locale);
  };

/**
 * The capabilities that admit an avatar mutation. The media service is
 * provided only once a mutation is admitted, so a media configuration failure
 * never hides a session, release or account refusal.
 */
const avatarAdmissionLayer = Layer.mergeAll(
  CustomerAuthentication.Default,
  AccountAvatarReleaseGate.Live,
  CustomerAccountResolver.Live
);

/**
 * Uploads the submitted file as the signed-in customer's avatar and
 * revalidates the account pages once it is stored. The file is read only
 * once the mutation is admitted.
 */
const uploadAvatarMutation = Effect.fn(
  function* (file: File, locale: Locale) {
    const account = yield* admitCurrentAvatarMutation;

    const buffer = yield* Effect.tryPromise({
      try: () => file.arrayBuffer(),
      catch: (cause) =>
        new PublicSafeActionError({
          message: m.accountProfileError({}, { locale }),
          cause: cause instanceof Error ? cause : undefined,
        }),
    });

    const outcome = yield* uploadAccountAvatar(account, {
      bytes: new Uint8Array(buffer),
      declaredSize: file.size,
      declaredMediaType: file.type,
    }).pipe(Effect.provide(CustomerAvatarService.Live));

    if (outcome.status === "uploaded") {
      yield* revalidateAccount(locale);
    }
    return outcome;
  },
  (effect, _file, locale) =>
    effect.pipe(
      Effect.provide(avatarAdmissionLayer),
      Effect.mapError(mapAvatarActionError(locale))
    )
);

/**
 * Removes the signed-in customer's avatar and revalidates the account pages
 * once it is gone.
 */
const removeAvatarMutation = Effect.fn(
  function* (locale: Locale) {
    const account = yield* admitCurrentAvatarMutation;
    const outcome = yield* removeAccountAvatar(account).pipe(
      Effect.provide(CustomerAvatarService.Live)
    );
    if (outcome.status === "removed") {
      yield* revalidateAccount(locale);
    }
    return outcome;
  },
  (effect, locale) =>
    effect.pipe(
      Effect.provide(avatarAdmissionLayer),
      Effect.mapError(mapAvatarActionError(locale))
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
  (_input, { locale }) => removeAvatarMutation(locale)
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
