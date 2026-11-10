import "server-only";

import {
  type CustomerAvatar,
  CustomerAvatarRejected,
  type CustomerAvatarRejectionReason,
  customerAvatarFileField,
  customerAvatarMaxBodyBytes,
  customerAvatarMaxUploadBytes,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer, Match, Stream } from "effect";
import { type HttpServerRequest, Multipasta } from "effect/unstable/http";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  admitCurrentAvatarMutation,
  type CustomerAvatarMutationResult,
  type CustomerAvatarUpload,
  uploadAccountAvatar,
} from "@/features/account/backend/customer-avatar-mutations";
import { providePerRequest } from "@/shared/backend/provide-per-request";
import { CustomerAccountLayers } from "./customer-account-layers";
import {
  answerCustomerApiFailure,
  answerUnavailable,
} from "./customer-api-failure";

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
    // The contract's part stream isn't read: Effect's multipart stream drops
    // a parser failure when the end of the body arrives in the same chunk,
    // so `readAvatarFile` parses the request's body itself.
    function* ({
      request,
    }: {
      readonly request: HttpServerRequest.HttpServerRequest;
    }) {
      const account = yield* admitCurrentAvatarMutation;
      const upload = yield* readAvatarFile(request);
      const outcome = yield* uploadAccountAvatar(account, upload).pipe(
        // Provided only once admitted, so a media configuration failure
        // never hides a session, release or account refusal.
        Effect.provide(services.avatar)
      );
      return yield* answerAvatarUpload(outcome);
    },
    // The avatar release decides for this request alone.
    providePerRequest(admission),
    Effect.catchTags(
      {
        CustomerAvatarRejected: (rejection) => Effect.fail(rejection),
        // Already logged with the reason it answers.
        CustomerServiceUnavailable: (unavailable) => Effect.fail(unavailable),
      },
      (failure) => answerCustomerApiFailure(operation)(Effect.fail(failure))
    )
  );
});

/** A part of the upload's body, with a file part's bytes. */
type AvatarBodyPart =
  | {
      readonly kind: "file";
      readonly name: string;
      readonly contentType: string;
      readonly chunks: Uint8Array[];
    }
  | { readonly kind: "field" };

/**
 * Parses the upload's body as it arrives. The first failure the parser
 * reports stays the answer, whatever it reads after; `write` says whether to
 * keep reading, which stops at that failure or the closing delimiter.
 */
const parseAvatarBody = (headers: Readonly<Record<string, string>>) => {
  const parts: AvatarBodyPart[] = [];
  let failure: Multipasta.MultipartError | undefined;
  let done = false;
  const parser = Multipasta.make({
    headers,
    maxParts: 1,
    // The parser counts the part's headers toward its size; the explicit
    // file-size check below enforces the file limit.
    maxPartSize: customerAvatarMaxBodyBytes,
    maxFieldSize: 1024,
    maxTotalSize: customerAvatarMaxBodyBytes,
    onField: () => {
      parts.push({ kind: "field" });
    },
    onFile: ({ name, contentType }) => {
      const chunks: Uint8Array[] = [];
      parts.push({ kind: "file", name, contentType, chunks });
      return (chunk) => {
        if (chunk !== null) chunks.push(chunk);
      };
    },
    onError: (error) => {
      // Bytes after the closing delimiter in its chunk aren't the upload's.
      if (!done) failure ??= error;
    },
    onDone: () => {
      done = true;
    },
  });
  return {
    write: (chunk: Uint8Array) => {
      parser.write(chunk);
      return failure === undefined && !done;
    },
    end: () => {
      if (failure === undefined && !done) parser.end();
      return { parts, failure, done };
    },
  };
};

/**
 * Reads the upload's single `file` part into memory. The body is read until
 * the parser refuses it or reaches its closing delimiter, so the read stops
 * at the first chunk past the size limit, and a file is accepted only from
 * a complete body with nothing but that part.
 */
const readAvatarFile = Effect.fnUntraced(function* (
  request: HttpServerRequest.HttpServerRequest
) {
  const body = parseAvatarBody(request.headers);
  yield* request.stream.pipe(
    Stream.runForEachWhile((chunk) => Effect.sync(() => body.write(chunk))),
    Effect.catch(() =>
      avatarRejected("file-missing", { multipartReason: "unreadable-body" })
    )
  );
  const { parts, failure, done } = body.end();
  if (failure !== undefined) return yield* refusedBody(failure);
  const [file] = parts;
  if (
    !done ||
    parts.length !== 1 ||
    file?.kind !== "file" ||
    file.name !== customerAvatarFileField
  ) {
    return yield* avatarRejected("file-missing", { parts: parts.length });
  }
  const bytes = new Uint8Array(Buffer.concat(file.chunks));
  if (bytes.length > customerAvatarMaxUploadBytes) {
    return yield* avatarRejected("file-too-large");
  }
  return {
    bytes,
    declaredSize: bytes.length,
    declaredMediaType: file.contentType,
  } satisfies CustomerAvatarUpload;
});

/**
 * Rejects a body the parser refused. A body or part past its size limit is
 * too large; any other refusal (a part past the one allowed, a text field
 * past its size, malformed multipart, a body that ends early) means the
 * request carries no readable avatar file, the reason the contract has for
 * exactly that.
 */
const refusedBody = (error: Multipasta.MultipartError) =>
  avatarRejected(
    error._tag === "ReachedLimit" &&
      (error.limit === "MaxPartSize" || error.limit === "MaxTotalSize")
      ? "file-too-large"
      : "file-missing",
    {
      multipartReason: error._tag === "ReachedLimit" ? error.limit : error._tag,
    }
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
        answerUnavailable(operation, { reason: "avatar-provider-retryable" }),
    })
  );
