import "server-only";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Data, Effect, Layer, Option, Predicate, Result } from "effect";
import { notFound } from "next/navigation";
import type {
  FlattenedValidationErrors,
  SafeActionResult,
  ValidationErrors,
} from "next-safe-action";
import type { SingleInputActionFn } from "next-safe-action/hooks";
import type { AdministrationPath } from "@/features/administration/administration-href";
import type { Locale } from "@/features/i18n";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import {
  defineWorkspaceAction,
  type WorkspaceActionContext,
  type WorkspaceActionFailureCopy,
  type WorkspaceActionOptions,
} from "@/shared/backend/workspace-action";
import {
  runWorkspaceEffect,
  runWorkspaceEffectOrElse,
} from "@/shared/backend/workspace-effect";
import {
  PublicSafeActionError,
  type SafeActionFailure,
} from "@/shared/utils/safe-action-client";
import { CurrentAdministrator } from "../backend/current-administrator";
import {
  type AdministratorUnauthorizedError,
  authorizeAdministratorPage,
  requireAdministratorAuthorization,
} from "./administrator-authorization.server";

/**
 * The record an administration page shows doesn't exist. A page query fails
 * with it to answer the request with the ordinary 404.
 */
export class AdministrationRecordNotFound extends Data.TaggedError(
  "AdministrationRecordNotFound"
) {}

const isAdministrationRecordNotFound = Predicate.isTagged(
  "AdministrationRecordNotFound"
);

/** Next.js refused to revalidate a page a successful action changed. */
class AdministrationRevalidationError extends Data.TaggedError(
  "AdministrationRevalidationError"
)<{
  readonly cause: unknown;
}> {}

/** A cache refresh a successful action asked for could not start. */
class AdministrationRefreshError extends Data.TaggedError(
  "AdministrationRefreshError"
)<{
  readonly cause: unknown;
}> {}

const actingAs = <R, LE>(
  capabilities: Layer.Layer<R, LE, CurrentAdministrator>,
  administrator: CurrentAdministrator["Service"]
) =>
  Layer.provideMerge(
    capabilities,
    Layer.succeed(CurrentAdministrator, administrator)
  );

/**
 * Runs an administration page's query as the administrator the page gate
 * authorized. The gate runs once per request, so every loader of a page
 * shares one session read; a signed-out visitor goes to sign-in and an
 * account without the grant gets the ordinary 404. A query that fails with
 * {@link AdministrationRecordNotFound} answers with the 404 too.
 */
export const runAdministrationPage = async <A, E, R, LE>(
  operation: string,
  query: Effect.Effect<
    A,
    E | AdministrationRecordNotFound,
    R | CurrentAdministrator
  >,
  capabilities: Layer.Layer<R, LE, CurrentAdministrator>
): Promise<A> => {
  const administrator = await authorizeAdministratorPage();
  const found = await query.pipe(
    Effect.map(Option.some),
    Effect.catchIf(isAdministrationRecordNotFound, () => Effect.succeedNone),
    Effect.provide(actingAs(capabilities, administrator)),
    runWorkspaceEffect(operation, { boundary: "route" })
  );
  if (Option.isNone(found)) notFound();
  return found.value;
};

export interface AdministrationActionOptions<
  S extends StandardSchemaV1,
  A,
  E,
  R,
  LE,
> extends WorkspaceActionOptions<S> {
  /** Copy for the runtime's own failures, from the area's catalog. */
  readonly failureCopy: WorkspaceActionFailureCopy;
  /** What the handler needs besides the acting administrator. */
  readonly capabilities: Layer.Layer<R, LE, CurrentAdministrator>;
  /**
   * The public message for a failure, in the action's locale, or undefined to
   * keep it private and show `fallback`. It also words a caller who isn't an
   * administrator, unless `unauthorizedResult` answers them.
   */
  readonly publicFailure?: (
    failure: E | LE | AdministratorUnauthorizedError,
    locale: Locale
  ) => string | undefined;
  /**
   * The result for a caller who isn't an administrator, for a client that
   * reads refusals as data. Without it, the refusal is a failure.
   */
  readonly unauthorizedResult?: A;
  /**
   * The administration pages a successful run changed. They are revalidated
   * in every locale after the action settles, outside its fiber: a fiber
   * resumed by a database callback can run under another request's Next.js
   * work store, where `revalidatePath` throws because that request is
   * rendering. If Next.js refuses one, the action answers with
   * `failureCopy.unexpected`, although the change itself was made.
   */
  readonly revalidates?: (
    input: StandardSchemaV1.InferOutput<S>,
    result: A
  ) => readonly AdministrationPath[];
  /**
   * Starts refreshing what a successful run made stale besides its pages,
   * such as a tagged data cache. It runs after the action settles, outside its
   * fiber, for the same reason as `revalidates`. A refresh is best effort: if
   * it throws, the failure is logged and the action still succeeds.
   */
  readonly refreshes?: (
    input: StandardSchemaV1.InferOutput<S>,
    result: A
  ) => void;
}

type AdministrationValidationErrors<S extends StandardSchemaV1> =
  FlattenedValidationErrors<ValidationErrors<S>>;

/** An operator action, as the Admin UI calls it. */
type AdministrationAction<S extends StandardSchemaV1, A> = SingleInputActionFn<
  string,
  S,
  AdministrationValidationErrors<S>,
  A
>;

interface SettledAdministrationAction<A> {
  readonly result: A;
  readonly locale: Locale;
  readonly revalidates: readonly AdministrationPath[];
  readonly refresh: () => void;
}

/**
 * Applies what a successful run changed. It runs synchronously in the
 * action's own async context, so Next.js sees the request that ran the action.
 */
const applySettledChanges = <A>({
  refresh,
  revalidates,
}: SettledAdministrationAction<A>) => ({
  refreshed: Result.try({
    try: refresh,
    catch: (cause) => new AdministrationRefreshError({ cause }),
  }),
  revalidated: Result.try({
    try: () => {
      for (const path of revalidates) revalidateLocalizedPath(path);
    },
    catch: (cause) => new AdministrationRevalidationError({ cause }),
  }),
});

/**
 * Defines an operator action of the Admin UI. The handler runs only for an
 * administrator: anyone else fails closed, without a redirect, before the
 * handler or its capabilities start. The handler acts as that
 * `CurrentAdministrator`, its failures are worded through `publicFailure`,
 * and the pages and caches it changed are refreshed after it settles.
 */
export const defineAdministrationAction = <
  S extends StandardSchemaV1,
  A,
  E extends SafeActionFailure,
  R,
  LE extends SafeActionFailure,
>(
  options: AdministrationActionOptions<S, A, E, R, LE>,
  handler: (
    input: StandardSchemaV1.InferOutput<S>,
    context: WorkspaceActionContext<S>
  ) => Effect.Effect<A, E, R | CurrentAdministrator>
) => {
  const {
    capabilities,
    publicFailure,
    refreshes,
    revalidates,
    unauthorizedResult,
    ...workspaceOptions
  } = options;

  const toPublicFailure =
    (locale: Locale) =>
    (
      failure: E | LE | AdministratorUnauthorizedError | PublicSafeActionError
    ) => {
      if (failure instanceof PublicSafeActionError) return failure;
      const message = publicFailure?.(failure, locale);
      return message === undefined
        ? failure
        : new PublicSafeActionError({ message, cause: failure });
    };

  const action = defineWorkspaceAction(
    workspaceOptions,
    (input, context) =>
      requireAdministratorAuthorization.pipe(
        Effect.flatMap((administrator) =>
          handler(input, context).pipe(
            Effect.map(
              (result): SettledAdministrationAction<A> => ({
                result,
                locale: context.locale,
                revalidates: revalidates?.(input, result) ?? [],
                refresh: () => refreshes?.(input, result),
              })
            ),
            Effect.provide(actingAs(capabilities, administrator))
          )
        ),
        Effect.catchIf(
          (failure) =>
            unauthorizedResult !== undefined &&
            Predicate.isTagged(failure, "AdministratorUnauthorizedError"),
          () =>
            Effect.succeed<SettledAdministrationAction<A>>({
              result: unauthorizedResult as A,
              locale: context.locale,
              revalidates: [],
              refresh: () => undefined,
            })
        ),
        Effect.mapError(toPublicFailure(context.locale))
      ) as Effect.Effect<
        SettledAdministrationAction<A>,
        E | LE | AdministratorUnauthorizedError | PublicSafeActionError
      >
  );

  type ActionResult = SafeActionResult<
    string,
    S,
    AdministrationValidationErrors<S>,
    A
  >;

  const administrationAction: AdministrationAction<S, A> = async (input) => {
    const { data, ...settled } = await action(
      input as Parameters<typeof action>[0]
    );
    if (data === undefined) return settled as ActionResult;

    const { refreshed, revalidated } = applySettledChanges(data);
    if (Result.isFailure(refreshed) || Result.isFailure(revalidated)) {
      await Effect.gen(function* () {
        if (Result.isFailure(refreshed)) {
          yield* Effect.logWarning("Administration cache refresh failed").pipe(
            Effect.annotateLogs({ error: refreshed.failure })
          );
        }
        if (Result.isFailure(revalidated)) {
          yield* Effect.logError("Action failed").pipe(
            Effect.annotateLogs({ error: revalidated.failure })
          );
        }
      }).pipe(
        // The change was made, so logging must not change the answer.
        runWorkspaceEffectOrElse(workspaceOptions.operation, {
          boundary: "action",
          failureCode: "administration_settlement_log_failed",
          orElse: () => undefined,
        })
      );
    }
    if (Result.isFailure(revalidated)) {
      return {
        serverError: workspaceOptions.failureCopy.unexpected(
          {},
          { locale: data.locale }
        ),
      } as ActionResult;
    }
    return { ...settled, data: data.result } as ActionResult;
  };
  return administrationAction;
};
