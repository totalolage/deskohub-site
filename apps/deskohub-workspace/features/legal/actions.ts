"use server";

import { Data, Effect, Layer, Option, Schema } from "effect";
import { cookies } from "next/headers";
import { WorkspaceDatabase } from "@/db/database.service";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { type Locale, locales } from "@/features/i18n";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { CustomerMarketingConsentRepository } from "./backend/customer-marketing-consent.repository";
import { MarketingManagementService } from "./backend/marketing-management.service";
import {
  createMarketingManagementCookies,
  type MarketingManagementCookieOperations,
} from "./backend/marketing-management-cookies.server";
import {
  getMarketingManagementDismissalContext,
  type MarketingManagementCookies as MarketingManagementCookieValues,
  MarketingPreferencesAuthorityError,
  matchesMarketingManagementContext,
  resolveMarketingPreferencesAuthority,
} from "./backend/marketing-preferences-authority";

const marketingPreferencesContextSchema = Schema.NonEmptyString;

const saveMarketingPreferencesSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    source: Schema.Literals(["link", "account"]),
    context: marketingPreferencesContextSchema,
    granted: Schema.Boolean,
    confirmed: Schema.Literal(true),
    locale: Schema.Literals(locales),
  }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

const marketingManagementContextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ context: marketingPreferencesContextSchema }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

type MarketingPreferencesMutationFailureReason =
  | "invalid-link"
  | "pending-confirmation-required"
  | "stale-context"
  | "unavailable";

class MarketingPreferencesMutationError extends Data.TaggedError(
  "MarketingPreferencesMutationError"
)<{
  readonly reason: MarketingPreferencesMutationFailureReason;
}> {}

const marketingManagementServiceLive = MarketingManagementService.Default.pipe(
  Layer.provide(WorkspaceDatabase.Default)
);

const marketingConsentRepositoryLive =
  CustomerMarketingConsentRepository.Default.pipe(
    Layer.provide(WorkspaceDatabase.Default)
  );

const marketingPreferencesLive = Layer.mergeAll(
  CustomerAccountResolver.Live,
  marketingManagementServiceLive,
  marketingConsentRepositoryLive
);

type SaveMarketingPreferencesInput = {
  readonly source: "link" | "account";
  readonly context: string;
  readonly granted: boolean;
  readonly confirmed: true;
  readonly locale: Locale;
};

const saveMarketingPreferences = (
  input: SaveMarketingPreferencesInput,
  marketingCookies: MarketingManagementCookieOperations
) =>
  Effect.gen(function* () {
    const authority =
      yield* loadMarketingPreferencesAuthority(marketingCookies);
    if (
      authority.kind === "pending" ||
      !matchesMarketingManagementContext(authority, input.source, input.context)
    ) {
      return yield* mutationFailureError(
        authority.kind === "pending"
          ? "pending-confirmation-required"
          : "stale-context"
      );
    }

    const documents = yield* getLegalAcceptanceSnapshot(input.locale).pipe(
      Effect.mapError(() => mutationError("unavailable"))
    );

    // The rendered context is only a concurrency fence. Re-read the current
    // authority immediately before writing and use its customer identity, not
    // anything supplied by the browser.
    const currentAuthority =
      yield* loadMarketingPreferencesAuthority(marketingCookies);
    if (
      !matchesMarketingManagementContext(
        currentAuthority,
        input.source,
        input.context
      )
    ) {
      return yield* mutationFailureError("stale-context");
    }

    const consents = yield* CustomerMarketingConsentRepository;
    const consentInput = {
      dotyposCustomerId: currentAuthority.customerId,
      documentHash: documents.marketingCommunications.hash,
      locale: input.locale,
      grantedAt: Temporal.Now.instant(),
    };

    if (input.granted) {
      yield* consents
        .grant(consentInput)
        .pipe(Effect.mapError(() => mutationError("unavailable")));
    } else {
      yield* consents
        .withdraw(consentInput)
        .pipe(Effect.mapError(() => mutationError("unavailable")));
    }

    return { status: "saved" as const };
  });

type MarketingManagementContextInput = { readonly context: string };

const confirmMarketingManagement = (
  input: MarketingManagementContextInput,
  marketingCookies: MarketingManagementCookieOperations
) =>
  Effect.gen(function* () {
    const management = yield* MarketingManagementService;
    const cookies =
      yield* readMarketingManagementCookiesEffect(marketingCookies);
    const pending = yield* resolvePendingAuthority(cookies, management);
    if (pending.kind !== "pending" || pending.context !== input.context) {
      return yield* mutationFailureError("stale-context");
    }

    // Exchange only after checking the digest of the current pending cookie.
    // This action is the explicit confirmation boundary; reads never call
    // exchange.
    const currentCookies =
      yield* readMarketingManagementCookiesEffect(marketingCookies);
    const currentPending = yield* resolvePendingAuthority(
      currentCookies,
      management
    );
    if (
      currentPending.kind !== "pending" ||
      currentPending.context !== input.context
    ) {
      return yield* mutationFailureError("stale-context");
    }

    const exchanged = yield* management
      .exchange(currentPending.rawPending)
      .pipe(Effect.mapError(mapManagementMutationFailure));

    // Cookie state can change while the provider exchange is in flight. Do
    // not install a session for a stale pending context.
    const beforeCookieWrite =
      yield* readMarketingManagementCookiesEffect(marketingCookies);
    const pendingBeforeCookieWrite = yield* resolvePendingAuthority(
      beforeCookieWrite,
      management
    );
    if (
      pendingBeforeCookieWrite.kind !== "pending" ||
      pendingBeforeCookieWrite.context !== input.context
    ) {
      return yield* mutationFailureError("stale-context");
    }

    yield* invokeCookieMutation(() =>
      marketingCookies.setMarketingManagementSessionCookie(exchanged)
    );
    return { status: "confirmed" as const };
  });

const saveMarketingPreferencesEffect = (
  input: SaveMarketingPreferencesInput,
  marketingCookies: MarketingManagementCookieOperations,
  layers = marketingPreferencesLive
) =>
  saveMarketingPreferences(input, marketingCookies).pipe(
    Effect.provide(layers),
    Effect.mapError((failure) =>
      failure instanceof MarketingPreferencesMutationError
        ? failure
        : mutationError("unavailable")
    ),
    Effect.mapError(toPublicMutationError)
  );

const confirmMarketingManagementEffect = (
  input: MarketingManagementContextInput,
  marketingCookies: MarketingManagementCookieOperations,
  layers = marketingManagementServiceLive
) =>
  confirmMarketingManagement(input, marketingCookies).pipe(
    Effect.provide(layers),
    Effect.mapError((failure) =>
      failure instanceof MarketingPreferencesMutationError
        ? failure
        : mutationError("unavailable")
    ),
    Effect.mapError(toPublicMutationError)
  );

const clearMarketingManagementEffect = (
  input: MarketingManagementContextInput,
  marketingCookies: MarketingManagementCookieOperations,
  layers = marketingManagementServiceLive
) =>
  readMarketingManagementCookiesEffect(marketingCookies).pipe(
    Effect.flatMap((currentCookies) => {
      if (
        getMarketingManagementDismissalContext(currentCookies) !== input.context
      ) {
        return mutationFailureError("stale-context");
      }

      if (currentCookies.session === undefined) {
        return invokeCookieMutation(
          marketingCookies.clearMarketingManagementCookies
        ).pipe(Effect.as({ status: "cleared" as const }));
      }

      return clearMarketingManagementSession(
        currentCookies.session,
        marketingCookies
      ).pipe(Effect.provide(layers), Effect.as({ status: "cleared" as const }));
    }),
    Effect.mapError((failure) =>
      failure instanceof MarketingPreferencesMutationError
        ? failure
        : mutationError("unavailable")
    ),
    Effect.mapError(toPublicMutationError)
  );

const loadMarketingPreferencesAuthority = (
  marketingCookies: MarketingManagementCookieOperations
) =>
  Effect.gen(function* () {
    const cookieValues =
      yield* readMarketingManagementCookiesEffect(marketingCookies);
    const management = yield* MarketingManagementService;
    const accountResolver = yield* CustomerAccountResolver;
    return yield* resolveMarketingPreferencesAuthority(cookieValues, {
      resolveAccount: () => accountResolver.resolve,
      resolveManagementSession: (rawSession) => management.resolve(rawSession),
    }).pipe(Effect.mapError(mapAuthorityFailure));
  });

const resolvePendingAuthority = (
  cookies: MarketingManagementCookieValues,
  management: MarketingManagementService["Service"]
) =>
  resolveMarketingPreferencesAuthority(cookies, {
    // A pending cookie must not need the account capability. This callback is
    // never called while pending is present; if it is, fail closed.
    resolveAccount: () =>
      Effect.fail(
        new MarketingPreferencesAuthorityError({ reason: "unavailable" })
      ),
    resolveManagementSession: (rawSession) => management.resolve(rawSession),
  }).pipe(Effect.mapError(mapAuthorityFailure));

const clearMarketingManagementSession = (
  session: string,
  marketingCookies: MarketingManagementCookieOperations
) =>
  Effect.gen(function* () {
    const management = yield* MarketingManagementService;
    yield* management
      .revoke(session)
      .pipe(
        Effect.catch((cause) =>
          hasManagementFailureReason(cause, "invalid_credential")
            ? Effect.void
            : Effect.fail(mutationError("unavailable"))
        )
      );
    yield* invokeCookieMutation(
      marketingCookies.clearMarketingManagementCookies
    );
  });

const readMarketingManagementCookiesEffect = (
  marketingCookies: MarketingManagementCookieOperations
) =>
  Effect.tryPromise({
    try: marketingCookies.readMarketingManagementCookies,
    catch: () => mutationError("unavailable"),
  });

const invokeCookieMutation = (operation: () => void | Promise<void>) =>
  Effect.tryPromise({
    try: async () => {
      await operation();
    },
    catch: () => mutationError("unavailable"),
  });

const mutationError = (reason: MarketingPreferencesMutationFailureReason) =>
  new MarketingPreferencesMutationError({ reason });

const mutationFailureError = (
  reason: MarketingPreferencesMutationFailureReason
) => Effect.fail(mutationError(reason));

const mapAuthorityFailure = (
  failure: MarketingPreferencesAuthorityError
): MarketingPreferencesMutationError => mutationError(failure.reason);

const mapManagementMutationFailure = (
  cause: unknown
): MarketingPreferencesMutationError =>
  hasManagementFailureReason(cause, "invalid_credential")
    ? mutationError("invalid-link")
    : mutationError("unavailable");

const managementFailureReasonSchema = Schema.TaggedStruct(
  "MarketingManagementError",
  {
    reason: Schema.Literals(["invalid_credential", "unavailable"]),
  }
);

const hasManagementFailureReason = (
  cause: unknown,
  reason: "invalid_credential" | "unavailable"
): boolean =>
  Option.getOrUndefined(
    Schema.decodeUnknownOption(managementFailureReasonSchema)(cause)
  )?.reason === reason;

const toPublicMutationError = (
  failure: MarketingPreferencesMutationError
): PublicSafeActionError =>
  new PublicSafeActionError({
    message: publicMutationMessage(failure.reason),
    cause: failure,
  });

const publicMutationMessage = (
  reason: MarketingPreferencesMutationFailureReason
): string => {
  if (reason === "invalid-link") {
    return "This marketing management link is invalid or has expired.";
  }
  if (reason === "stale-context") {
    return "This marketing preference context is no longer current. Refresh the page and try again.";
  }
  if (reason === "pending-confirmation-required") {
    return "Confirm this management link before saving a marketing preference.";
  }
  return "We could not update your marketing preference. Please try again.";
};

const createSaveMarketingPreferencesAction = (
  marketingCookies: MarketingManagementCookieOperations
) =>
  defineWorkspaceAction(
    {
      operation: "legal.marketing-preferences.save",
      schema: saveMarketingPreferencesSchema,
      logInput: false,
    },
    (input) => saveMarketingPreferencesEffect(input, marketingCookies)
  );

const createConfirmMarketingManagementAction = (
  marketingCookies: MarketingManagementCookieOperations
) =>
  defineWorkspaceAction(
    {
      operation: "legal.marketing-preferences.confirm",
      schema: marketingManagementContextSchema,
      logInput: false,
    },
    (input) => confirmMarketingManagementEffect(input, marketingCookies)
  );

const createClearMarketingManagementAction = (
  marketingCookies: MarketingManagementCookieOperations
) =>
  defineWorkspaceAction(
    {
      operation: "legal.marketing-preferences.clear",
      schema: marketingManagementContextSchema,
      logInput: false,
    },
    (input) => clearMarketingManagementEffect(input, marketingCookies)
  );

type SaveMarketingPreferencesAction = ReturnType<
  typeof createSaveMarketingPreferencesAction
>;
type ConfirmMarketingManagementAction = ReturnType<
  typeof createConfirmMarketingManagementAction
>;
type ClearMarketingManagementAction = ReturnType<
  typeof createClearMarketingManagementAction
>;

export const saveMarketingPreferencesAction: SaveMarketingPreferencesAction =
  async (...args: Parameters<SaveMarketingPreferencesAction>) => {
    "use server";
    const cookieStore = await cookies();
    const marketingCookies = createMarketingManagementCookies(cookieStore);
    return await createSaveMarketingPreferencesAction(marketingCookies)(
      ...args
    );
  };

export const confirmMarketingManagementAction: ConfirmMarketingManagementAction =
  async (...args: Parameters<ConfirmMarketingManagementAction>) => {
    "use server";
    const cookieStore = await cookies();
    const marketingCookies = createMarketingManagementCookies(cookieStore);
    return await createConfirmMarketingManagementAction(marketingCookies)(
      ...args
    );
  };

export const clearMarketingManagementAction: ClearMarketingManagementAction =
  async (...args: Parameters<ClearMarketingManagementAction>) => {
    "use server";
    const cookieStore = await cookies();
    const marketingCookies = createMarketingManagementCookies(cookieStore);
    return await createClearMarketingManagementAction(marketingCookies)(
      ...args
    );
  };
