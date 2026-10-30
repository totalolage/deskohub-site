import "server-only";

import { Context, Data, Effect, Layer, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  CustomerAccountAccessError,
  CustomerAccountResolver,
} from "@/features/account";
import type { Locale } from "@/features/i18n";
import type {
  MarketingPreferencesMutationFailureReason,
  MarketingPreferencesRejection,
  MarketingPreferencesRejectionReason,
  MarketingPreferencesState,
} from "../marketing-preferences";
import { MarketingConsentLedger } from "./marketing-consent-ledger";
import { MarketingManagementService } from "./marketing-management.service";
import { MarketingManagementCookies } from "./marketing-management-cookies.service";
import {
  getMarketingManagementDismissalContext,
  getPendingMarketingManagementContext,
  isInvalidMarketingManagementCredential,
  type MarketingManagementCookies as MarketingManagementCookieValues,
  type MarketingPreferencesAuthority,
  matchesMarketingManagementContext,
  resolveMarketingPreferencesAuthority,
} from "./marketing-preferences-authority";

type SaveMarketingPreferencesInput = {
  readonly source: "link" | "account";
  readonly context: string;
  readonly granted: boolean;
  readonly locale: Locale;
};

type ManagementContext = { readonly context: string };
type AccountPreferences = CustomerAccountResolver | MarketingConsentLedger;
type MutationResult<S extends string> =
  | { readonly status: S }
  | MarketingPreferencesRejection;

export class MarketingPreferencesMutationError extends Data.TaggedError(
  "MarketingPreferencesMutationError"
)<{
  readonly reason: MarketingPreferencesMutationFailureReason;
}> {
  static unavailable = () =>
    new MarketingPreferencesMutationError({ reason: "unavailable" });
}

interface IMarketingPreferences {
  readonly read: Effect.Effect<
    MarketingPreferencesState,
    MarketingPreferencesMutationError,
    AccountPreferences
  >;
  readonly save: (
    input: SaveMarketingPreferencesInput
  ) => Effect.Effect<
    MutationResult<"saved">,
    MarketingPreferencesMutationError,
    AccountPreferences
  >;
  readonly confirm: (
    input: ManagementContext
  ) => Effect.Effect<
    MutationResult<"confirmed">,
    MarketingPreferencesMutationError
  >;
  readonly clear: (
    input: ManagementContext
  ) => Effect.Effect<
    MutationResult<"cleared">,
    MarketingPreferencesMutationError
  >;
}

export class MarketingPreferences extends Context.Service<
  MarketingPreferences,
  IMarketingPreferences
>()("@deskohub-workspace/legal/MarketingPreferences") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const cookies = yield* MarketingManagementCookies;
      const management = yield* MarketingManagementService;
      // Only read/save need account and ledger capabilities. Keep them on those
      // operations so confirmation/dismissal can run without account configuration.
      const resolveAuthority = (values: MarketingManagementCookieValues) =>
        Effect.flatMap(CustomerAccountResolver, (account) =>
          resolveMarketingPreferencesAuthority(values, {
            resolveAccount: () => account.resolve,
            resolveManagementSession: management.resolve,
          })
        ).pipe(Effect.mapError((failure) => mutationError(failure.reason)));
      const loadAuthority = cookies.read.pipe(
        Effect.mapError(MarketingPreferencesMutationError.unavailable),
        Effect.flatMap(resolveAuthority)
      );
      const pendingAuthority = cookies.read.pipe(
        Effect.mapError(MarketingPreferencesMutationError.unavailable),
        Effect.flatMap((values) =>
          resolveMarketingPreferencesAuthority(values, {
            // Missing pending authority must never fall through to the account.
            resolveAccount: () =>
              Effect.fail(
                new CustomerAccountAccessError({ reason: "unavailable" })
              ),
            resolveManagementSession: management.resolve,
          })
        ),
        Effect.mapError((failure) => mutationError(failure.reason))
      );
      const checkPending = (input: ManagementContext) =>
        pendingAuthority.pipe(
          Effect.filterOrFail(
            (
              authority
            ): authority is Extract<
              MarketingPreferencesAuthority,
              { readonly kind: "pending" }
            > =>
              authority.kind === "pending" &&
              authority.context === input.context,
            () => mutationError("stale-context")
          )
        );
      const checkPendingContext = (input: ManagementContext) =>
        cookies.read.pipe(
          Effect.mapError(MarketingPreferencesMutationError.unavailable),
          Effect.filterOrFail(
            (values) =>
              values.pending !== undefined &&
              getPendingMarketingManagementContext(values.pending) ===
                input.context,
            () => mutationError("stale-context")
          )
        );
      const checkDismissal = (input: ManagementContext) =>
        cookies.read.pipe(
          Effect.mapError(MarketingPreferencesMutationError.unavailable),
          Effect.filterOrFail(
            (values) =>
              getMarketingManagementDismissalContext(values) === input.context,
            () => mutationError("stale-context")
          )
        );

      return {
        read: readPreferences(cookies, resolveAuthority).pipe(
          Effect.withSpan("MarketingPreferences.read")
        ),
        save: Effect.fn("MarketingPreferences.save")((input) =>
          Effect.Do.pipe(
            Effect.bind("authority", () => loadAuthority),
            Effect.tap(({ authority }) =>
              Effect.fail(
                mutationError(
                  authority.kind === "pending"
                    ? "pending-confirmation-required"
                    : "stale-context"
                )
              ).pipe(
                Effect.when(
                  Effect.succeed(
                    !matchesMarketingManagementContext(
                      authority,
                      input.source,
                      input.context
                    )
                  )
                )
              )
            ),
            Effect.bind("current", () =>
              loadAuthority.pipe(
                Effect.filterOrFail(
                  (authority) =>
                    matchesMarketingManagementContext(
                      authority,
                      input.source,
                      input.context
                    ),
                  () => mutationError("stale-context")
                )
              )
            ),
            Effect.bind("ledger", () => MarketingConsentLedger),
            Effect.tap(({ current, ledger }) =>
              ledger
                .record(
                  input.granted
                    ? {
                        customerId: current.customerId,
                        locale: input.locale,
                        choice: "grant",
                        mode: "explicit",
                        channel: input.source,
                      }
                    : {
                        customerId: current.customerId,
                        locale: input.locale,
                        choice: "withdraw",
                      }
                )
                .pipe(
                  Effect.mapError(MarketingPreferencesMutationError.unavailable)
                )
            ),
            Effect.as({ status: "saved" as const }),
            settleMutationRejection
          )
        ),
        confirm: Effect.fn("MarketingPreferences.confirm")((input) =>
          Effect.Do.pipe(
            Effect.bind("pending", () => checkPending(input)),
            // Revalidate before consuming the single-use credential.
            Effect.tap(() => checkPendingContext(input)),
            Effect.bind("exchanged", ({ pending }) =>
              management
                .exchange(pending.rawPending)
                .pipe(
                  Effect.mapError((failure) =>
                    mutationError(
                      isInvalidMarketingManagementCredential(failure)
                        ? "invalid-link"
                        : "unavailable"
                    )
                  )
                )
            ),
            // Check only cookie context after exchange, never resolve the consumed token.
            Effect.tap(() => checkPendingContext(input)),
            Effect.tap(({ exchanged }) =>
              cookies
                .setSession(exchanged)
                .pipe(
                  Effect.mapError(MarketingPreferencesMutationError.unavailable)
                )
            ),
            Effect.as({ status: "confirmed" as const }),
            settleMutationRejection
          )
        ),
        clear: Effect.fn("MarketingPreferences.clear")((input) =>
          Effect.Do.pipe(
            Effect.tap(() => checkDismissal(input)),
            Effect.bind("current", () => checkDismissal(input)),
            Effect.tap(({ current }) =>
              Effect.forEach(
                current.session === undefined ? [] : [current.session],
                (session) =>
                  management
                    .revoke(session)
                    .pipe(
                      Effect.catch((failure) =>
                        isInvalidMarketingManagementCredential(failure)
                          ? Effect.void
                          : Effect.fail(
                              MarketingPreferencesMutationError.unavailable()
                            )
                      )
                    )
              )
            ),
            // Revocation may have succeeded on an earlier attempt. Do not resolve
            // the revoked session, so a failed cookie write remains retryable.
            Effect.tap(() => checkDismissal(input)),
            Effect.tap(() =>
              cookies.clear.pipe(
                Effect.mapError(MarketingPreferencesMutationError.unavailable)
              )
            ),
            Effect.as({ status: "cleared" as const }),
            settleMutationRejection
          )
        ),
      } satisfies IMarketingPreferences;
    })
  );

  static ManagementLive = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        MarketingManagementCookies.Default,
        MarketingManagementService.Default.pipe(
          Layer.provide(WorkspaceDatabase.Default)
        )
      )
    )
  );

  static Live = this.ManagementLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(CustomerAccountResolver.Live, MarketingConsentLedger.Live)
    )
  );
}

function readPreferences(
  cookies: MarketingManagementCookies["Service"],
  resolveAuthority: (
    values: MarketingManagementCookieValues
  ) => Effect.Effect<
    MarketingPreferencesAuthority,
    MarketingPreferencesMutationError,
    CustomerAccountResolver
  >
) {
  return Effect.Do.pipe(
    Effect.bind("values", () =>
      cookies.read.pipe(
        Effect.mapError(MarketingPreferencesMutationError.unavailable)
      )
    ),
    Effect.let("dismissalContext", ({ values }) =>
      getMarketingManagementDismissalContext(values)
    ),
    Effect.bind("authority", ({ values }) =>
      resolveAuthority(values).pipe(Effect.result)
    ),
    Effect.flatMap(
      ({
        authority,
        dismissalContext,
      }): Effect.Effect<
        MarketingPreferencesState,
        MarketingPreferencesMutationError,
        MarketingConsentLedger
      > => {
        if (Result.isFailure(authority)) {
          return Effect.succeed(
            authority.failure.reason === "invalid-link"
              ? { status: "invalid-link", dismissalContext }
              : { status: "unavailable" }
          );
        }
        const current = authority.success;
        if (current.kind === "pending")
          return Effect.succeed({
            status: "pending-link",
            context: current.context,
            dismissalContext,
          });
        return Effect.flatMap(MarketingConsentLedger, (ledger) =>
          ledger.status(current.customerId)
        ).pipe(
          Effect.mapError(MarketingPreferencesMutationError.unavailable),
          Effect.map(
            (status): MarketingPreferencesState =>
              current.kind === "link"
                ? {
                    status,
                    source: current.source,
                    context: current.context,
                    dismissalContext,
                  }
                : { status, source: current.source, context: current.context }
          )
        );
      }
    )
  );
}

function mutationError(reason: MarketingPreferencesMutationFailureReason) {
  return new MarketingPreferencesMutationError({ reason });
}

function settleMutationRejection<A, E, R>(
  effect: Effect.Effect<A, E | MarketingPreferencesMutationError, R>
) {
  return effect.pipe(
    Effect.catchIf(
      (
        failure
      ): failure is MarketingPreferencesMutationError & {
        readonly reason: MarketingPreferencesRejectionReason;
      } =>
        failure instanceof MarketingPreferencesMutationError &&
        failure.reason !== "unavailable",
      ({ reason }) =>
        Effect.succeed<MarketingPreferencesRejection>({
          status: "rejected",
          reason,
        })
    )
  );
}
