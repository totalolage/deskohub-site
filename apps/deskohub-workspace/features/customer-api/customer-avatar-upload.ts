import "server-only";

import {
  type CustomerAvatar,
  CustomerAvatarRejected,
  type CustomerAvatarRejectionReason,
  CustomerFeatureUnavailable,
  CustomerServiceUnavailable,
  customerAvatarFileField,
  customerAvatarMaxUploadBytes,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer, Match, Option, Stream } from "effect";
import { Multipart } from "effect/unstable/http";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  admitCurrentAvatarMutation,
  type CustomerAvatarMutationResult,
  type CustomerAvatarUpload,
  uploadAccountAvatar,
} from "@/features/account/backend/customer-avatar-mutations";
import { CustomerAccountLayers } from "./customer-account-layers";
import { answerCustomerApiFailure } from "./customer-api-failure";

const operation = "customerApi.uploadAvatar";

/**
 * The handler of `PUT /account/avatar`, built with the account group from
 * its `CustomerAccountLayers` and the authentication the session middleware
 * reads the request through. It admits the mutation as the avatar server
 * action does (verified session, open avatar release, linked account), then
 * reads the one `file` part and stores it as the account's avatar. The body
 * is read only once the mutation is admitted.
 */
export const customerAvatarUploadHandler = Effect.gen(function* () {
  const { services, releases } = yield* CustomerAccountLayers;
  const admission = Layer.mergeAll(
    Layer.succeed(CustomerAuthentication, yield* CustomerAuthentication),
    services.resolver,
    releases.avatarRelease
  );

  return Effect.fn(operation)(
    function* ({
      payload,
    }: {
      readonly payload: Stream.Stream<Multipart.Part, Multipart.MultipartError>;
    }) {
      const account = yield* admitCurrentAvatarMutation;
      const upload = yield* readAvatarFile(payload);
      const outcome = yield* uploadAccountAvatar(account, upload).pipe(
        // Provided only once admitted, so a media configuration failure
        // never hides a session, release or account refusal.
        Effect.provide(services.avatar)
      );
      return yield* answerAvatarUpload(outcome);
    },
    Effect.provide(admission),
    Effect.catchTags(
      {
        AccountFeatureWithheldError: ({ feature }) =>
          Effect.fail(new CustomerFeatureUnavailable({ feature })),
        CustomerAvatarRejected: (rejection) => Effect.fail(rejection),
        // Already logged with the reason it answers.
        CustomerServiceUnavailable: (unavailable) => Effect.fail(unavailable),
      },
      (failure) => answerCustomerApiFailure(operation)(Effect.fail(failure))
    )
  );
});

/**
 * Reads the upload's single `file` part into memory.
 *
 * The whole part stream runs first, so the parser reaches the end of the
 * body or refuses it before the file's bytes are read: a file read while the
 * parser still runs never ends on a body cut off inside it. The parser holds
 * at most the contract's total size and stops reading the body at the first
 * chunk past it. Its part-count and file-size refusals are lost when the
 * same chunk also ends the body, so the part count and the file size are
 * checked here as well.
 */
const readAvatarFile = (
  payload: Stream.Stream<Multipart.Part, Multipart.MultipartError>
) =>
  Stream.runCollect(payload).pipe(
    Effect.catchTag("MultipartError", refusedBody),
    Effect.flatMap((parts) =>
      Option.match(avatarFilePart(parts), {
        onNone: () => avatarRejected("file-missing", { parts: parts.length }),
        onSome: readFilePart,
      })
    )
  );

/** The upload's file part: the only part, a file named `file`. */
const avatarFilePart = (parts: ReadonlyArray<Multipart.Part>) =>
  Option.fromNullishOr(parts.length === 1 ? parts[0] : undefined).pipe(
    Option.filter(
      (part): part is Multipart.File =>
        Multipart.isFile(part) && part.key === customerAvatarFileField
    )
  );

/** The file part's bytes, already buffered by the parser. */
const readFilePart = (file: Multipart.File) =>
  file.contentEffect.pipe(
    Effect.catchTag("MultipartError", refusedBody),
    Effect.filterOrElse(
      (bytes) => bytes.length <= customerAvatarMaxUploadBytes,
      () => avatarRejected("file-too-large")
    ),
    Effect.map(
      (bytes): CustomerAvatarUpload => ({
        bytes,
        declaredSize: bytes.length,
        declaredMediaType: file.contentType,
      })
    )
  );

/**
 * Rejects a body the parser refused. A body past the file or total size
 * limit is too large; any other refusal (a part past the one allowed, a
 * text field past its size, malformed multipart, a body that ends early or
 * can't be read) means the request carries no readable avatar file, the
 * reason the contract has for exactly that.
 */
const refusedBody = (error: Multipart.MultipartError) =>
  avatarRejected(
    Match.value(error.reason._tag).pipe(
      Match.whenOr(
        "FileTooLarge",
        "BodyTooLarge",
        () => "file-too-large" as const
      ),
      Match.whenOr(
        "TooManyParts",
        "FieldTooLarge",
        "Parse",
        "InternalError",
        () => "file-missing" as const
      ),
      Match.exhaustive
    ),
    { multipartReason: error.reason._tag }
  );

/** Fails with the rejection, logging its fixed codes first. */
const avatarRejected = (
  reason: CustomerAvatarRejectionReason,
  codes: Readonly<Record<string, string | number>> = {}
) =>
  Effect.logInfo("Customer avatar upload rejected.").pipe(
    Effect.annotateLogs({ operation, reason, ...codes }),
    Effect.andThen(Effect.fail(new CustomerAvatarRejected({ reason })))
  );

/**
 * The contract's answer for the media step's outcome. A retryable provider
 * failure is unavailable, which the client may retry.
 */
const answerAvatarUpload = (
  outcome: Exclude<CustomerAvatarMutationResult, { status: "removed" }>
) =>
  Match.value(outcome).pipe(
    Match.discriminatorsExhaustive("status")({
      uploaded: ({ avatar }) =>
        Effect.succeed<CustomerAvatar>({
          url: avatar.url,
          ...(avatar.version !== undefined && { version: avatar.version }),
        }),
      rejected: ({ reason }) => avatarRejected(reason),
      retryable: () =>
        Effect.logWarning("Customer API request failed.").pipe(
          Effect.annotateLogs({
            operation,
            answer: "CustomerServiceUnavailable",
            reason: "avatar-provider-retryable",
          }),
          Effect.andThen(Effect.fail(new CustomerServiceUnavailable()))
        ),
    })
  );
