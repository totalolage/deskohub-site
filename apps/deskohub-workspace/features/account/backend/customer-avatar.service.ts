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
          Effect.as(stagedId),
          Effect.mapError(() => new CustomerAvatarProviderError({}))
        );
    })
  );

/**
 * Promotes the staged asset onto the account's fixed live public ID. The
 * provider does not document rename-with-overwrite as atomic, so a failure
 * is treated as uncertain: the promotion is retried once, and only after a
 * second failure is the outcome reported as retryable. The staged asset is
 * cleaned up best-effort; a destroy that races a lost rename response is
 * simply not-found, and the previous avatar stays untouched unless the
 * provider actually confirmed the swap.
 */
const promoteStaged = (
  cloudinary: CloudinaryService["Service"],
  stagedId: CloudinaryPublicId,
  liveId: CloudinaryPublicId
): Effect.Effect<CloudinaryAsset, CustomerAvatarProviderError> =>
  cloudinary.renameAsset(stagedId, liveId, { overwrite: true }).pipe(
    Effect.retry(Schedule.recurs(1)),
    Effect.tapError(() =>
      Effect.ignore(cloudinary.destroyAsset(stagedId).pipe(Effect.asVoid))
    ),
    Effect.mapError(() => new CustomerAvatarProviderError({}))
  );

const toAvatar = (asset: CloudinaryAsset): CustomerAvatar => ({
  url: buildVersionedDeliveryUrl(asset),
  version: asset.version,
});
