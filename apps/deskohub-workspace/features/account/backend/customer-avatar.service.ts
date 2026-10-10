import "server-only";

import {
  type CloudinaryAsset,
  type CloudinaryPublicId,
  CloudinaryPublicIdSchema,
} from "@deskohub/cloudinary";
import { buildVersionedDeliveryUrl } from "@deskohub/cloudinary/delivery";
import {
  CloudinaryService,
  makeCloudinaryRuntimeConfigLayer,
} from "@deskohub/cloudinary/server";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { env } from "@/env";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountUnavailable,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAuthentication } from "./customer-authentication.service";
import {
  CustomerAvatarRejectedError,
  customerAvatarAllowedMediaTypes,
  customerAvatarMaxUploadBytes,
  normalizeCustomerAvatar,
} from "./customer-avatar-normalization";

export type { CustomerAvatarRejectionReason } from "./customer-avatar-normalization";

/**
 * The avatar asset as the account page and actions see it: a versioned
 * delivery URL derived from the asset itself, never persisted anywhere.
 */
export type CustomerAvatar = {
  readonly url: string;
  readonly version?: number;
};

export type CustomerAvatarUploadInput = {
  readonly bytes: Uint8Array;
  readonly declaredSize: number;
  readonly declaredMediaType: string;
};

/** Retryable media-provider failure; the operation may safely be retried. */
export class CustomerAvatarProviderError extends Data.TaggedError(
  "CustomerAvatarProviderError"
)<Record<string, never>> {}

/**
 * Fail-closed namespace failure: the avatar feature is unavailable because
 * the deployment namespace cannot be determined. The feature never falls
 * back to the production namespace.
 */
export class CustomerAvatarUnavailableError extends Data.TaggedError(
  "CustomerAvatarUnavailableError"
)<Record<string, never>> {}

export type CustomerAvatarError =
  | CustomerAvatarRejectedError
  | CustomerAvatarUnavailableError
  | CustomerAvatarProviderError;

/**
 * The avatar folder namespace for one environment. A preview deployment
 * writes only into its own immutable commit-scoped namespace; when that
 * scope cannot be determined the result is `Option.none()` and every avatar
 * mutation fails closed. There is no code path that returns the production
 * namespace outside the production environment.
 */
export const deriveCustomerAvatarNamespace = (deployment: {
  readonly vercelEnvironment: string;
  readonly deploymentId: Option.Option<string>;
}): Option.Option<string> => {
  switch (deployment.vercelEnvironment) {
    case "production":
      return Option.some("avatars/production");
    case "development":
      return Option.some("avatars/development");
    case "preview":
      return Option.flatMap(deployment.deploymentId, (id) => {
        const immutablePreviewId = id.trim();
        return immutablePreviewId.length > 0
          ? Option.some(`avatars/preview/${immutablePreviewId}`)
          : Option.none();
      });
    default:
      return Option.none();
  }
};

/**
 * Environment-scoped avatar settings resolved once at layer construction.
 * A `none` namespace keeps the account page working (initials fallback)
 * while mutations report the avatar feature as unavailable.
 */
export class CustomerAvatarSettings extends Context.Service<
  CustomerAvatarSettings,
  { readonly namespace: Option.Option<string> }
>()("@deskohub-workspace/account/CustomerAvatarSettings") {
  static Live = Layer.sync(this, () => ({
    namespace: deriveCustomerAvatarNamespace({
      vercelEnvironment: env.VERCEL_ENV,
      deploymentId: Option.fromUndefinedOr(env.VERCEL_GIT_COMMIT_SHA),
    }),
  }));
}

const WorkspaceCloudinaryLayer = CloudinaryService.Live.pipe(
  Layer.provide(
    makeCloudinaryRuntimeConfigLayer({
      cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
      defaultPageSize: 60,
      serviceName: "workspace",
    })
  )
);

class GuardedSectionError<E> extends Data.TaggedError("GuardedSectionError")<{
  readonly error: E;
}> {}

interface ICustomerAvatarService {
  /**
   * Normalizes and stores the upload as the account's single avatar. The
   * previous avatar stays live until the provider confirms the promotion.
   * Runs under the account advisory lock and re-checks the verified session
   * for this account and the deletion marker.
   */
  readonly upload: (
    accountId: CustomerAccountId,
    input: CustomerAvatarUploadInput
  ) => Effect.Effect<
    CustomerAvatar,
    CustomerAvatarError | CustomerAccountAccessError
  >;
  /**
   * Removes the avatar; a missing asset is success, a failed or uncertain
   * destroy is a retryable failure. Same guarded preconditions as upload.
   */
  readonly remove: (
    accountId: CustomerAccountId
  ) => Effect.Effect<
    void,
    | CustomerAvatarProviderError
    | CustomerAvatarUnavailableError
    | CustomerAccountAccessError
  >;
  /**
   * Bare asset destroy for the deletion hook, which already holds the
   * account advisory lock: a missing asset is success, an uncertain
   * provider outcome is a retryable failure so identity removal waits.
   */
  readonly destroy: (
    accountId: CustomerAccountId
  ) => Effect.Effect<
    void,
    CustomerAvatarProviderError | CustomerAvatarUnavailableError
  >;
  /**
   * Reads the current avatar for page render: `null` when the account has
   * no avatar, a typed failure only when the provider is unreachable.
   */
  readonly lookup: (
    accountId: CustomerAccountId
  ) => Effect.Effect<
    CustomerAvatar | null,
    CustomerAvatarProviderError | CustomerAvatarUnavailableError
  >;
}

export class CustomerAvatarService extends Context.Service<
  CustomerAvatarService,
  ICustomerAvatarService
>()("@deskohub-workspace/account/CustomerAvatarService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const cloudinary = yield* CloudinaryService;
      const links = yield* CustomerAccountLinkRepository;
      const authentication = yield* CustomerAuthentication;
      const settings = yield* CustomerAvatarSettings;

      const requireNamespace: Effect.Effect<
        string,
        CustomerAvatarUnavailableError
      > = Option.match(settings.namespace, {
        onSome: (namespace) => Effect.succeed(namespace),
        onNone: () => Effect.fail(new CustomerAvatarUnavailableError({})),
      });

      const destroyById = (publicId: CloudinaryPublicId) =>
        destroyAssetById(cloudinary, publicId);

      const requireSameVerifiedAccount = (accountId: CustomerAccountId) =>
        authentication.currentUser.pipe(
          Effect.flatMap((session) =>
            session?.accountId === accountId
              ? Effect.void
              : Effect.fail(
                  new CustomerAccountAccessError({ reason: "unauthenticated" })
                )
          )
        );

      /**
       * Runs an avatar mutation under the account advisory lock after
       * re-reading the verified session and authoritative activity state, so
       * a concurrent revocation or deletion marker stops provider work.
       * A concurrent deletion marker can only land before or after the whole
       * mutation.
       * The lock's own SqlError maps to the shared account-unavailable
       * failure; the section's typed errors pass through unchanged.
       *
       * The whole media critical section — provider calls, reconciliation,
       * and cleanup — is uninterruptible while the lock is held: a timed-out
       * action (or any interruption) cannot release the lock while a
       * provider rename, upload, or destroy is still in flight, so no late
       * provider mutation can land after a concurrent deletion destroyed the
       * avatar and removed the identity. Provider requests stay bounded well
       * under the 45s action timeout by the package's transient-retry
       * schedule (at most 2 retries with sub-second backoff).
       */
      const guarded = <A, E, R>(
        accountId: CustomerAccountId,
        mutation: Effect.Effect<A, E, R>
      ): Effect.Effect<
        A,
        E | CustomerAvatarUnavailableError | CustomerAccountAccessError,
        R
      > =>
        links
          .withAccountLock(
            accountId,
            requireAccountActivity(links, accountId).pipe(
              Effect.andThen(requireSameVerifiedAccount(accountId)),
              Effect.andThen(mutation),
              Effect.uninterruptible,
              Effect.mapError((error) => new GuardedSectionError({ error }))
            )
          )
          .pipe(
            Effect.catch((failure) =>
              failure._tag === "GuardedSectionError"
                ? Effect.fail(failure.error)
                : Effect.fail(customerAccountUnavailable("account-link.lock"))
            )
          );

      /**
       * Bare asset destroy for the deletion hook: the live asset goes first,
       * then any account-owned staging assets left behind by a previously
       * failed promotion are removed so deletion leaves no recoverable
       * copies. An uncertain live or staging outcome fails retryably so
       * identity removal waits; missing assets are idempotent success.
       * Uninterruptible so the outcome always settles before the caller's
       * lock is released.
       */
      const destroy: ICustomerAvatarService["destroy"] = (accountId) =>
        requireNamespace.pipe(
          Effect.andThen((namespace) =>
            destroyById(livePublicIdFor(namespace, accountId)).pipe(
              Effect.andThen(destroyStaging(cloudinary, namespace, accountId))
            )
          ),
          Effect.uninterruptible
        );

      const remove: ICustomerAvatarService["remove"] = (accountId) =>
        guarded(accountId, destroy(accountId));

      const lookup: ICustomerAvatarService["lookup"] = (accountId) =>
        requireNamespace.pipe(
          Effect.andThen((namespace) =>
            cloudinary
              .getByPublicId(livePublicIdFor(namespace, accountId))
              .pipe(
                Effect.map(toAvatar),
                Effect.catch((error) =>
                  error._tag === "CloudinarySearchError" &&
                  error.httpCode === 404
                    ? Effect.succeed(null)
                    : Effect.fail(new CustomerAvatarProviderError({}))
                )
              )
          )
        );

      const upload: ICustomerAvatarService["upload"] = (accountId, input) =>
        guarded(
          accountId,
          requireNamespace.pipe(
            Effect.andThen((namespace) =>
              Effect.flatMap(validateUploadInput(input), () =>
                Effect.flatMap(
                  normalizeCustomerAvatar(input.bytes),
                  (normalized) =>
                    Effect.flatMap(
                      recoverRetainedStaging(
                        cloudinary,
                        namespace,
                        accountId
                      ).pipe(Effect.ignore),
                      () =>
                        Effect.flatMap(
                          stageUpload(
                            cloudinary,
                            namespace,
                            accountId,
                            normalized
                          ),
                          (staged) =>
                            Effect.flatMap(
                              promoteStaged(
                                cloudinary,
                                staged,
                                livePublicIdFor(namespace, accountId)
                              ),
                              (promoted) =>
                                Effect.succeed({
                                  url: buildVersionedDeliveryUrl(promoted),
                                  version: promoted.version,
                                })
                            )
                        )
                    )
                )
              )
            )
          )
        );

      return {
        upload,
        remove,
        destroy,
        lookup,
      } satisfies ICustomerAvatarService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAvatarSettings.Live,
        CustomerAuthentication.Default,
        CustomerAccountLinkRepository.Live,
        WorkspaceCloudinaryLayer
      )
    )
  );
}

const allowedMediaTypes: ReadonlySet<string> = new Set(
  customerAvatarAllowedMediaTypes
);

/**
 * Checks the claimed and actual byte size and the declared media type
 * against the input policy before any bytes are decoded.
 */
const validateUploadInput = (
  input: CustomerAvatarUploadInput
): Effect.Effect<void, CustomerAvatarRejectedError> =>
  !allowedMediaTypes.has(input.declaredMediaType)
    ? Effect.fail(
        new CustomerAvatarRejectedError({ reason: "unsupported-format" })
      )
    : Effect.succeed(undefined).pipe(
        Effect.filterOrFail(
          () =>
            input.declaredSize <= customerAvatarMaxUploadBytes &&
            input.bytes.byteLength <= customerAvatarMaxUploadBytes,
          () => new CustomerAvatarRejectedError({ reason: "file-too-large" })
        )
      );

/**
 * The deterministic per-account staging prefix inside the environment
 * namespace. Every attempt still stages under a unique UUID suffix, but the
 * prefix itself is computed, so retained staging assets stay discoverable
 * for recovery and deletion without persisting any avatar state in Neon.
 */
const accountStagingFolder = (
  namespace: string,
  accountId: CustomerAccountId
): string => `${namespace}-staging/${accountId}`;

const livePublicIdFor = (
  namespace: string,
  accountId: CustomerAccountId
): CloudinaryPublicId =>
  Schema.decodeSync(CloudinaryPublicIdSchema)(`${namespace}/${accountId}`);

const destroyAssetById = (
  cloudinary: CloudinaryService["Service"],
  publicId: CloudinaryPublicId
): Effect.Effect<void, CustomerAvatarProviderError> =>
  cloudinary.destroyAsset(publicId).pipe(
    Effect.asVoid,
    Effect.mapError(() => new CustomerAvatarProviderError({}))
  );

/**
 * Bounded listing of one account's retained staging assets. The listing goes
 * through the sanitized folder-listing call, which never logs the
 * account-bearing folder or any returned asset identity.
 */
const stagingRecoveryBatchSize = 8;

const listStagedAssets = (
  cloudinary: CloudinaryService["Service"],
  folder: string
): Effect.Effect<readonly CloudinaryAsset[], CustomerAvatarProviderError> =>
  cloudinary
    .listFolderAssets(folder, { maxResults: stagingRecoveryBatchSize })
    .pipe(Effect.mapError(() => new CustomerAvatarProviderError({})));

/**
 * Recovers a staging asset retained by a previously failed promotion — but
 * only when the live lookup definitively reports that no live avatar
 * exists. A live asset means recovery would overwrite a newer image with an
 * older retained one, so it is skipped; a lookup failure is also skipped
 * (the stale staging simply becomes cleanup material for deletion). A
 * recovery failure never blocks the fresh upload, which promotes over the
 * live ID anyway.
 */
const recoverRetainedStaging = (
  cloudinary: CloudinaryService["Service"],
  namespace: string,
  accountId: CustomerAccountId
): Effect.Effect<void, never> =>
  cloudinary.getByPublicId(livePublicIdFor(namespace, accountId)).pipe(
    Effect.catch((error) =>
      error._tag === "CloudinarySearchError" && error.httpCode === 404
        ? Effect.succeed(null)
        : Effect.fail(new CustomerAvatarProviderError({}))
    ),
    Effect.flatMap((liveAsset) =>
      liveAsset
        ? Effect.void
        : listStagedAssets(
            cloudinary,
            accountStagingFolder(namespace, accountId)
          ).pipe(
            Effect.flatMap((staged) =>
              staged.length === 0
                ? Effect.void
                : promoteStaged(
                    cloudinary,
                    staged[0]!,
                    livePublicIdFor(namespace, accountId)
                  ).pipe(Effect.asVoid)
            )
          )
    ),
    Effect.ignore
  );

/**
 * Deletes all account-owned staging assets through Cloudinary's explicit
 * delete-by-public-ID-prefix API. Search is eventually consistent and cannot
 * prove that the folder is empty. The provider package follows deletion
 * cursors with a bounded page limit; malformed, failed, or incomplete
 * results keep account deletion retryable.
 */
const destroyStaging = (
  cloudinary: CloudinaryService["Service"],
  namespace: string,
  accountId: CustomerAccountId
): Effect.Effect<void, CustomerAvatarProviderError> =>
  cloudinary
    .deleteResourcesByPublicIdPrefix(
      Schema.decodeSync(CloudinaryPublicIdSchema)(
        `${accountStagingFolder(namespace, accountId)}/`
      )
    )
    .pipe(Effect.mapError(() => new CustomerAvatarProviderError({})));

/**
 * Stage upload under a unique temporary public ID. Replacement works
 * because promotion (below) renames onto the fixed live public ID with
 * overwrite; the live asset is never written directly.
 *
 * The staged asset — including the provider's immutable `asset_id` — is
 * owned across the whole upload lifecycle: the provider can accept the
 * bytes and still fail the call (lost or undecodable response), so a failed
 * upload destroys the known staging ID best-effort instead of leaving an
 * orphan, and the identity is what reconciles an ambiguous promotion.
 */
const stageUpload = (
  cloudinary: CloudinaryService["Service"],
  namespace: string,
  accountId: CustomerAccountId,
  bytes: Uint8Array
): Effect.Effect<CloudinaryAsset, CustomerAvatarProviderError> =>
  Effect.sync(() => crypto.randomUUID()).pipe(
    Effect.flatMap((token) => {
      const folder = accountStagingFolder(namespace, accountId);
      const stagedId = Schema.decodeSync(CloudinaryPublicIdSchema)(
        `${folder}/${token}`
      );
      return cloudinary
        .uploadImage({
          bytes,
          publicId: Schema.decodeSync(CloudinaryPublicIdSchema)(token),
          folder,
        })
        .pipe(
          Effect.catch(() =>
            cloudinary
              .destroyAsset(stagedId)
              .pipe(
                Effect.ignore,
                Effect.andThen(Effect.fail(new CustomerAvatarProviderError({})))
              )
          ),
          Effect.mapError(() => new CustomerAvatarProviderError({}))
        );
    })
  );

const lookupAssetOrNone = (
  cloudinary: CloudinaryService["Service"],
  publicId: CloudinaryPublicId
): Effect.Effect<CloudinaryAsset | null, never> =>
  cloudinary
    .getByPublicId(publicId)
    .pipe(Effect.catch(() => Effect.succeed(null)));

const destroyStagedBestEffort = (
  cloudinary: CloudinaryService["Service"],
  stagedId: CloudinaryPublicId
): Effect.Effect<void, never> =>
  Effect.ignore(cloudinary.destroyAsset(stagedId).pipe(Effect.asVoid));

/**
 * Promotes the staged asset onto the account's fixed live public ID. The
 * provider does not document rename-with-overwrite as atomic, so a failure
 * is uncertain: the promotion may have committed while the response was
 * lost. After the provider-level retry, the outcome is reconciled against
 * the live public ID before anything is destroyed — the staged asset may
 * be the only recoverable copy of the customer's upload.
 *
 * Reconciliation is identity-checked: the staged asset's immutable
 * `asset_id` survives the rename, so an asset found at the live ID counts
 * as the promoted upload only when its identity matches. The previous live
 * image may still be the asset at the live ID, and "any asset present" is
 * never treated as proof of promotion.
 *
 * - An identity match reports success with the live asset's versioned
 *   identity; staging is cleaned up best-effort.
 * - On source-missing reconciliation, an identity mismatch, missing identity,
 *   or lookup failure remains unknown: nothing is destroyed and a retryable
 *   failure is reported. After an ambiguous retry, a different known live
 *   identity proves the previous avatar remains, so staging is cleaned and
 *   the operation fails retryably.
 * - A definitive provider rejection cleans up staging without changing the
 *   prior live asset. An ambiguous rename is retried once and then reconciled
 *   by immutable asset identity; if no live asset can be identity-confirmed,
 *   staging is retained as the recoverable copy.
 */
const promoteStaged = (
  cloudinary: CloudinaryService["Service"],
  staged: CloudinaryAsset,
  liveId: CloudinaryPublicId
): Effect.Effect<CloudinaryAsset, CustomerAvatarProviderError> => {
  const stagedId = staged.public_id;
  const stagedAssetId = staged.asset_id;
  const attemptRename = () =>
    cloudinary.renameAsset(stagedId, liveId, { overwrite: true });
  const isKnownRenameFailure = (error: {
    readonly reason?: string;
    readonly httpCode?: number;
  }) =>
    error.reason === "target-exists" ||
    (error.reason === "failed" &&
      error.httpCode !== undefined &&
      error.httpCode >= 400 &&
      error.httpCode < 500 &&
      error.httpCode !== 499);
  const failAfterKnownFailure = () =>
    Effect.andThen(
      destroyStagedBestEffort(cloudinary, stagedId),
      Effect.fail(new CustomerAvatarProviderError({}))
    );

  /**
   * The staged source is gone after a `source-missing` outcome. The asset
   * at the live ID is this upload only when its immutable identity matches
   * the staged upload's; anything else (the previous avatar, an unknown
   * asset, no identity to compare, or a failed lookup) stays uncertain.
   */
  const reconcileSourceMissing = (): Effect.Effect<
    CloudinaryAsset,
    CustomerAvatarProviderError
  > =>
    lookupAssetOrNone(cloudinary, liveId).pipe(
      Effect.flatMap((liveAsset) =>
        liveAsset?.asset_id !== undefined &&
        liveAsset.asset_id === stagedAssetId
          ? Effect.as(destroyStagedBestEffort(cloudinary, stagedId), liveAsset)
          : Effect.fail(new CustomerAvatarProviderError({}))
      )
    );

  const reconcile = (error: {
    readonly reason?: string;
    readonly httpCode?: number;
  }): Effect.Effect<CloudinaryAsset, CustomerAvatarProviderError> => {
    if (error.reason === "source-missing") return reconcileSourceMissing();
    if (isKnownRenameFailure(error)) {
      // A definitive provider rejection did not promote this staged asset.
      // Clean it up while leaving the prior live asset untouched.
      return failAfterKnownFailure();
    }

    // The outcome is uncertain: retry promotion once, then reconcile against
    // the immutable provider identity before cleanup.
    return attemptRename().pipe(
      Effect.catch((retryError) => {
        if (retryError.reason === "source-missing") {
          return reconcileSourceMissing();
        }

        return lookupAssetOrNone(cloudinary, liveId).pipe(
          Effect.flatMap((liveAsset) => {
            if (
              liveAsset?.asset_id !== undefined &&
              liveAsset.asset_id === stagedAssetId
            ) {
              return Effect.as(
                destroyStagedBestEffort(cloudinary, stagedId),
                liveAsset
              );
            }
            if (liveAsset?.asset_id !== undefined) {
              // The old live identity is still present, so neither rename
              // promoted this staged asset.
              return failAfterKnownFailure();
            }
            // With no identity-confirmed live asset, the outcome remains
            // unknown. Keep staging as the recoverable copy and fail.
            return Effect.fail(new CustomerAvatarProviderError({}));
          })
        );
      })
    );
  };

  return attemptRename().pipe(
    Effect.catch(reconcile),
    Effect.mapError(() => new CustomerAvatarProviderError({}))
  );
};

const toAvatar = (asset: CloudinaryAsset): CustomerAvatar => ({
  url: buildVersionedDeliveryUrl(asset),
  version: asset.version,
});
