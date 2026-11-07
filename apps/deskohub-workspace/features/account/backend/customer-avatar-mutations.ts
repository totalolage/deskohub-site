import { Effect } from "effect";
import type { LinkedCustomerAccount } from "../customer-account";
import { requireAccountFeature } from "./account-feature-withheld";
import { AccountAvatarReleaseGate } from "./account-release-gates";
import { CustomerAccountResolver } from "./customer-account-resolver.service";
import {
  type CustomerAvatarRejectionReason,
  CustomerAvatarService,
} from "./customer-avatar.service";
import { requireVerifiedSession } from "./verified-customer-session";

export type CustomerAvatarView = {
  readonly url: string;
  readonly version?: number;
};

/** The uploaded file: its bytes and what the client declared about it. */
export type CustomerAvatarUpload = Parameters<
  CustomerAvatarService["Service"]["upload"]
>[1];

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

/**
 * Uploads the avatar of the current session's account. The account comes
 * from the authoritative resolver, never from client-supplied state, and the
 * upload is independent of the profile form. A withheld avatar release
 * refuses before resolution or media work.
 */
export const uploadCurrentCustomerAvatar = Effect.fn(
  "account.uploadCurrentCustomerAvatar"
)(function* (upload: CustomerAvatarUpload) {
  const account = yield* admitCurrentAvatarMutation;
  return yield* uploadAccountAvatar(account, upload);
});

/**
 * Removes the avatar of the current session's account. An uncertain removal
 * is retryable. A withheld avatar release refuses before resolution or media
 * work.
 */
export const removeCurrentCustomerAvatar = Effect.fn(
  "account.removeCurrentCustomerAvatar"
)(function* () {
  const account = yield* admitCurrentAvatarMutation;
  return yield* removeAccountAvatar(account);
});

/**
 * The first step of every avatar mutation: the verified session, an open
 * avatar release, and the session's resolved, linked account. A caller that
 * must do its own work between the steps, such as reading the upload only
 * once admitted, runs this and then the media step with its result.
 */
export const admitCurrentAvatarMutation = requireVerifiedSession.pipe(
  Effect.andThen(
    requireAccountFeature("avatars", AccountAvatarReleaseGate.isOpen)
  ),
  Effect.andThen(
    Effect.flatMap(CustomerAccountResolver, (resolver) => resolver.resolve)
  ),
  Effect.withSpan("account.admitCurrentAvatarMutation")
);

/**
 * The media step of an upload for an admitted account. The avatar service
 * re-checks the session and the deletion marker under the account lock.
 */
export const uploadAccountAvatar = Effect.fn("account.uploadAccountAvatar")(
  function* (account: LinkedCustomerAccount, upload: CustomerAvatarUpload) {
    const avatars = yield* CustomerAvatarService;
    return yield* avatars.upload(account.accountId, upload).pipe(
      Effect.map((avatar) => ({ status: "uploaded", avatar }) as const),
      Effect.catchTag("CustomerAvatarRejectedError", (error) =>
        Effect.succeed({ status: "rejected", reason: error.reason } as const)
      ),
      Effect.catchTag("CustomerAvatarProviderError", () =>
        Effect.succeed({ status: "retryable" } as const)
      )
    );
  }
);

/** The media step of a removal for an admitted account. */
export const removeAccountAvatar = Effect.fn("account.removeAccountAvatar")(
  function* (account: LinkedCustomerAccount) {
    const avatars = yield* CustomerAvatarService;
    return yield* avatars.remove(account.accountId).pipe(
      Effect.as({ status: "removed" } as const),
      Effect.catchTag("CustomerAvatarProviderError", () =>
        Effect.succeed({ status: "retryable" } as const)
      )
    );
  }
);
