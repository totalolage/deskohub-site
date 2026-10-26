import "server-only";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Data, Effect, Layer, Option, Predicate } from "effect";
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
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
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
   * rendering.
   */
  readonly revalidates?: (
    input: StandardSchemaV1.InferOutput<S>,
    result: A
  ) => readonly AdministrationPath[];
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
  readonly revalidates: readonly AdministrationPath[];
}

/**
 * Defines an operator action of the Admin UI. The handler runs only for an
 * administrator: anyone else fails closed, without a redirect, before the
 * handler or its capabilities start. The handler acts as that
 * `CurrentAdministrator`, its failures are worded through `publicFailure`,
 * and the pages it changed are revalidated after it settles.
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
                revalidates: revalidates?.(input, result) ?? [],
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
              revalidates: [],
            })
        ),
        Effect.mapError(toPublicFailure(context.locale))
      ) as Effect.Effect<
        SettledAdministrationAction<A>,
        E | LE | AdministratorUnauthorizedError | PublicSafeActionError
      >
  );

  const administrationAction: AdministrationAction<S, A> = async (input) => {
    const { data, ...settled } = await action(
      input as Parameters<typeof action>[0]
    );
    if (data !== undefined) {
      for (const path of data.revalidates) revalidateLocalizedPath(path);
    }
    return {
      ...settled,
      ...(data !== undefined && { data: data.result }),
    } as SafeActionResult<string, S, AdministrationValidationErrors<S>, A>;
  };
  return administrationAction;
};
