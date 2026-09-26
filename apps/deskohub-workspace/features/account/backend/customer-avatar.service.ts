import "server-only";

import {
  type CloudinaryAsset,
  type CloudinaryConfigError,
  type CloudinaryPublicId,
  CloudinaryPublicIdSchema,
} from "@deskohub/cloudinary";
import { buildVersionedDeliveryUrl } from "@deskohub/cloudinary/delivery";
import {
  CloudinaryService,
  makeCloudinaryRuntimeConfigLayer,
} from "@deskohub/cloudinary/server";
import { Context, Data, Effect, Layer, Option, Schedule, Schema } from "effect";
import { env } from "@/env";
import {
  type CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountUnavailable,
} from "../customer-account";
import { requireAccountActivity } from "./customer-account-activity";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
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
      return Option.map(
        deployment.deploymentId,
        (id) => `avatars/preview/${id}`
      );
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

const WorkspaceCloudinaryLayer = CloudinaryService.Default.pipe(
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
   * Runs under the account advisory lock and re-checks the deletion marker.
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
      const settings = yield* CustomerAvatarSettings;

      const requireNamespace: Effect.Effect<
        string,
        CustomerAvatarUnavailableError
      > = Option.match(settings.namespace, {
        onSome: (namespace) => Effect.succeed(namespace),
        onNone: () => Effect.fail(new CustomerAvatarUnavailableError({})),
      });

      const livePublicId = (
        namespace: string,
        accountId: CustomerAccountId
      ): CloudinaryPublicId =>
        Schema.decodeSync(CloudinaryPublicIdSchema)(
          `${namespace}/${accountId}`
        );

      const destroyById = (publicId: CloudinaryPublicId) =>
        cloudinary.destroyAsset(publicId).pipe(
          Effect.asVoid,
          Effect.mapError(() => new CustomerAvatarProviderError({}))
        );

      /**
       * Runs an avatar mutation under the account advisory lock after
       * re-reading the authoritative activity state, so a concurrent
       * deletion marker can only land before or after the whole mutation.
       * The lock's own SqlError maps to the shared account-unavailable
       * failure; the section's typed errors pass through unchanged.
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
              Effect.andThen(mutation),
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

      const destroy: ICustomerAvatarService["destroy"] = (accountId) =>
        requireNamespace.pipe(
          Effect.andThen((namespace) =>
            destroyById(livePublicId(namespace, accountId))
          )
        );

      const remove: ICustomerAvatarService["remove"] = (accountId) =>
        guarded(accountId, destroy(accountId));

      const lookup: ICustomerAvatarService["lookup"] = (accountId) =>
        requireNamespace.pipe(
          Effect.andThen((namespace) =>
            cloudinary.getByPublicId(livePublicId(namespace, accountId)).pipe(
              Effect.map(toAvatar),
              Effect.catch((error) =>
                error._tag === "CloudinarySearchError" && error.httpCode === 404
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
                      stageUpload(cloudinary, namespace, accountId, normalized),
                      (stagedId) =>
                        Effect.flatMap(
                          promoteStaged(
                            cloudinary,
                            stagedId,
                            livePublicId(namespace, accountId)
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
        CustomerAccountLinkRepository.Live,
        WorkspaceCloudinaryLayer
      )
    )
  );
}

/**
 * Page-render convenience: the account's current avatar, or `null` when the
 * account has none. A media outage surfaces as a typed failure so the page
 * can fall back to initials instead of blocking.
 */
export const getAccountAvatar = (
  accountId: CustomerAccountId
): Effect.Effect<
  CustomerAvatar | null,
  | CustomerAvatarProviderError
  | CustomerAvatarUnavailableError
  | CloudinaryConfigError
> =>
  Effect.flatMap(CustomerAvatarService, (service) =>
    service.lookup(accountId)
  ).pipe(Effect.provide(CustomerAvatarService.Live));

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
 * Stage upload under a unique temporary public ID. Replacement works
 * because promotion (below) renames onto the fixed live public ID with
 * overwrite; the live asset is never written directly.
 *
 * The staging ID is owned across the whole upload lifecycle: the provider
 * can accept the bytes and still fail the call (lost or undecodable
 * response), so a failed upload destroys the known staging ID best-effort
 * instead of leaving an orphan.
 */
const stageUpload = (
  cloudinary: CloudinaryService["Service"],
  namespace: string,
  accountId: CustomerAccountId,
  bytes: Uint8Array
): Effect.Effect<CloudinaryPublicId, CustomerAvatarProviderError> =>
  Effect.sync(() => crypto.randomUUID()).pipe(
    Effect.flatMap((token) => {
      const folder = `${namespace}-staging/${accountId}`;
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
          Effect.as(stagedId),
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
 * - A committed rename is reported as success with the live asset's
 *   versioned identity; staging is cleaned up best-effort.
 * - An uncommitted rename retries the promotion once; if the previous live
 *   avatar is intact, staging is safely cleaned and a retryable failure is
 *   reported; if there is no live asset, staging is retained because it is
 *   the only recoverable image.
 */
const promoteStaged = (
  cloudinary: CloudinaryService["Service"],
  stagedId: CloudinaryPublicId,
  liveId: CloudinaryPublicId
): Effect.Effect<CloudinaryAsset, CustomerAvatarProviderError> => {
  const attemptRename = () =>
    cloudinary.renameAsset(stagedId, liveId, { overwrite: true });

  const reconcile = (error: {
    readonly reason?: string;
  }): Effect.Effect<CloudinaryAsset, CustomerAvatarProviderError> =>
    error.reason === "source-missing"
      ? // The staged source is gone: the rename committed but its response
        // was lost. The live asset is the promoted avatar.
        lookupAssetOrNone(cloudinary, liveId).pipe(
          Effect.flatMap((liveAsset) =>
            liveAsset
              ? Effect.as(
                  destroyStagedBestEffort(cloudinary, stagedId),
                  liveAsset
                )
              : Effect.fail(new CustomerAvatarProviderError({}))
          )
        )
      : // The outcome is uncertain: the live avatar may still be the
        // previous one. Retry the promotion once, then reconcile again.
        attemptRename().pipe(
          Effect.catch((retryError) =>
            lookupAssetOrNone(cloudinary, liveId).pipe(
              Effect.flatMap((liveAsset) => {
                if (liveAsset && retryError.reason === "source-missing") {
                  // Committed on the retry; only the response was lost.
                  return Effect.as(
                    destroyStagedBestEffort(cloudinary, stagedId),
                    liveAsset
                  );
                }
                if (liveAsset) {
                  // Never committed: the previous avatar is intact and the
                  // customer can retry with a fresh staging upload.
                  return Effect.andThen(
                    destroyStagedBestEffort(cloudinary, stagedId),
                    Effect.fail(new CustomerAvatarProviderError({}))
                  );
                }
                // No live asset exists: staging is the only recoverable
                // copy, so it is retained for the retryable failure.
                return Effect.fail(new CustomerAvatarProviderError({}));
              })
            )
          )
        );

  return attemptRename().pipe(
    Effect.retry(Schedule.recurs(1)),
    Effect.catch(reconcile),
    Effect.mapError(() => new CustomerAvatarProviderError({}))
  );
};

const toAvatar = (asset: CloudinaryAsset): CustomerAvatar => ({
  url: buildVersionedDeliveryUrl(asset),
  version: asset.version,
});
