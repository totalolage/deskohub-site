import {
  AdministrationActionRecord,
  type AdministrationOperationBehavior,
  type AdministrationOperationReference,
  administrationOperationDeclaration,
  administrationOperationVariantOf,
  CurrentAdministrationCaller,
} from "@deskohub/workspace-admin-api";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Match,
  Option,
  Predicate,
  Ref,
  Schema,
} from "effect";
import {
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import type { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { CurrentAdministrationAction } from "./administration-action";
import {
  type AdministrationActionEnd,
  AdministrationActionLog,
} from "./administration-action-log.service";
import { mapServiceFailure } from "./administration-api-failure";

/** How long recording a request's end may hold its response. */
const finishTimeout = "5 seconds";

/**
 * Records every `write` and `destructive` administration request, except
 * a dry run, which changes nothing. The row is written before the
 * operation runs, so a change can't happen without one: if it can't be
 * written, the request fails with 503 and nothing runs.
 * Its end is recorded after the operation, and a failure to record it is
 * only logged, leaving the outcome `started`, so the response is the
 * operation's own.
 */
export const AdministrationActionRecordLive = Layer.effect(
  AdministrationActionRecord,
  Effect.gen(function* () {
    const log = yield* AdministrationActionLog;

    const recordAround = Effect.fn("AdministrationActionRecord.record")(
      function* <E, R>(
        httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
        operation: AdministrationOperationReference
      ) {
        const caller = yield* CurrentAdministrationCaller;
        const id = yield* log
          .start({ operation, caller })
          .pipe(mapServiceFailure);
        const replayed = yield* Ref.make(false);
        return yield* httpEffect.pipe(
          Effect.provideService(CurrentAdministrationAction, {
            markReplayed: Ref.set(replayed, true),
          }),
          Effect.onExit((exit) =>
            Ref.get(replayed).pipe(
              Effect.flatMap((wasReplayed) =>
                log.finish(id, endOf(exit, wasReplayed))
              ),
              Effect.timeout(finishTimeout),
              Effect.catchCause(() =>
                Effect.logWarning(
                  "Administration action end was not recorded",
                  { actionId: id, operation }
                )
              )
            )
          )
        );
      }
    );

    return (httpEffect, { group, endpoint }) =>
      recordedOperation(group, endpoint).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => httpEffect,
            onSome: (operation) => recordAround(httpEffect, operation),
          })
        )
      );
  })
);

/**
 * The operation a request records, or none for a read, a dry run or a
 * CLI-only endpoint. A generic mutation endpoint records the variant its
 * body names; a body that names none fails to decode and is recorded under
 * the endpoint.
 */
const recordedOperation = (
  group: HttpApiGroup.AnyWithProps,
  endpoint: HttpApiEndpoint.AnyWithProps
): Effect.Effect<
  Option.Option<AdministrationOperationReference>,
  never,
  HttpServerRequest.HttpServerRequest
> => {
  const reference: AdministrationOperationReference = `${group.identifier}.${endpoint.name}`;
  const declaration = administrationOperationDeclaration(
    Context.merge(group.annotations, endpoint.annotations)
  );
  if (Option.isNone(declaration)) {
    return Effect.succeed(Option.none());
  }
  return Match.value(declaration.value).pipe(
    Match.tagsExhaustive({
      Operation: ({
        behavior,
      }): Effect.Effect<
        Option.Option<AdministrationOperationReference>,
        never,
        HttpServerRequest.HttpServerRequest
      > =>
        Match.value(behavior).pipe(
          Match.when(
            (operation) => !changesState(operation),
            () => Effect.succeed(Option.none())
          ),
          Match.when({ preview: { _tag: "DryRun" } }, () =>
            requestsDryRun(endpoint).pipe(
              Effect.map((dryRun) =>
                dryRun ? Option.none() : Option.some(reference)
              )
            )
          ),
          Match.orElse(() => Effect.succeed(Option.some(reference)))
        ),
      Variants: ({ variants }) =>
        Object.values(variants.operations).some(changesState)
          ? requestBody.pipe(
              Effect.map((body) =>
                administrationOperationVariantOf(variants, body).pipe(
                  Option.match({
                    onNone: () => Option.some(reference),
                    onSome: (variant) =>
                      variants.operations[variant] !== undefined &&
                      changesState(variants.operations[variant])
                        ? Option.some(`${reference}.${variant}` as const)
                        : Option.none(),
                  })
                )
              )
            )
          : Effect.succeed(Option.none()),
      CliOnly: () => Effect.succeed(Option.none()),
    })
  );
};

const changesState = (behavior: AdministrationOperationBehavior["Service"]) =>
  behavior.kind !== "read";

/**
 * The request's JSON body, or undefined when it has none or isn't JSON.
 * The request caches its text, so the endpoint still decodes it after this.
 */
const requestBody = HttpServerRequest.HttpServerRequest.pipe(
  Effect.flatMap((request) => request.json),
  Effect.orElseSucceed((): unknown => undefined)
);

/**
 * Whether the request runs its operation as the dry run its contract
 * declares as the preview: the body decodes to `dryRun: true` with the
 * payload schema the endpoint picks for the request's JSON media type. A
 * body that doesn't decode is no dry run; the endpoint rejects it.
 */
const requestsDryRun = (endpoint: HttpApiEndpoint.AnyWithProps) =>
  HttpServerRequest.HttpServerRequest.pipe(
    Effect.flatMap((request) =>
      Option.fromNullishOr(endpoint.payload.get(mediaTypeOf(request))).pipe(
        Option.filter(({ encoding }) => encoding._tag === "Json"),
        Option.match({
          onNone: () => Effect.succeed(false),
          onSome: ({ schemas }) =>
            requestBody.pipe(
              Effect.map((body) =>
                // The first member that decodes, as the union decodes it.
                Option.firstSomeOf(
                  schemas.map((schema) =>
                    Schema.decodeUnknownOption(schema as Schema.Codec<unknown>)(
                      body
                    )
                  )
                ).pipe(
                  Option.exists(
                    (payload) =>
                      Predicate.hasProperty(payload, "dryRun") &&
                      payload.dryRun === true
                  )
                )
              )
            ),
        })
      )
    )
  );

/** The request's media type, as `HttpApiBuilder` picks a payload by it. */
const mediaTypeOf = (request: HttpServerRequest.HttpServerRequest) =>
  (request.headers["content-type"] || "application/json")
    .toLowerCase()
    .split(";", 1)[0]
    ?.trim() ?? "";

/** A declared administration error: every one is a tagged schema class. */
const TaggedError = Schema.Struct({ _tag: Schema.NonEmptyString });

const endOf = (
  exit: Exit.Exit<unknown, unknown>,
  replayed: boolean
): AdministrationActionEnd => {
  if (Exit.isSuccess(exit)) {
    return { outcome: replayed ? "replayed" : "succeeded" };
  }
  return Cause.findErrorOption(exit.cause).pipe(
    Option.match({
      onSome: (error): AdministrationActionEnd => ({
        outcome: "failed",
        failure: Schema.decodeUnknownOption(TaggedError)(error).pipe(
          Option.match({ onNone: () => "unknown", onSome: ({ _tag }) => _tag })
        ),
      }),
      onNone: (): AdministrationActionEnd =>
        Cause.hasDies(exit.cause)
          ? { outcome: "defect" }
          : { outcome: "interrupted" },
    })
  );
};
