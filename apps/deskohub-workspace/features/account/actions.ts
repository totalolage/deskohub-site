"use server";

import { type AresLookupFailure, AresLookupService } from "@deskohub/ares";
import { Effect, Layer, Match, Result, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  accountActionError,
  requireReferralsEnabled,
  requireVerifiedSession,
} from "@/features/account/account-action-guards";
import type { AresBusinessBillingDraft } from "@/features/account/backend/ares-business-draft";
import { toAresBusinessBillingDraft } from "@/features/account/backend/ares-business-draft";
import { deleteCurrentAccountThroughAuthEndpoint } from "@/features/account/backend/auth/delete-account-endpoint";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { saveAccountLocalePreference } from "@/features/account/backend/customer-locale-preference";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import { completeNewCustomerProfile } from "@/features/account/backend/profile-completion";
import { isRememberedReferralCodeUsed } from "@/features/account/backend/remembered-referral-code";
import { acknowledgeSignupReferral } from "@/features/account/backend/signup-referral";
import {
  type CustomerProfileInput,
  completeCustomerProfileStandardSchema,
  updateCustomerProfileStandardSchema,
} from "@/features/account/contracts";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  type LinkedCustomerAccount,
  mapCustomerAccountFailure,
} from "@/features/account/customer-account";
import { getAccountPath } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { locales, m } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import {
  forgetRememberedReferralCode,
  readRememberedReferralCode,
} from "@/features/referrals/remembered-referral-code.server";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const deleteCustomerAccountConfirmedSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ confirmed: Schema.Literal(true) }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

type ProfileCompletionReferral = {
  readonly code: string | undefined;
  readonly prefilledCode: string | undefined;
};

/**
 * The selectable locale preferences, derived from the Inlang `locales` tuple
 * so a locale list change is authoritative here too; the database CHECK
 * derives from the same list.
 */
const localePreferenceSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ locale: Schema.Literals(locales) }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

/**
 * Saves the Dotypos-owned profile for the verified account: a not-yet-linked
 * account creates and claims its customer profile, an already-linked account
 * updates it. Both paths run under the authoritative session, re-check the
 * deletion marker under the account lock, and never accept an email: the
 * profile input has no email field and the verified login email is read only
 * from the session. A referral code counts only when this save creates the
 * customer; an already-linked account ignores it.
 */
const saveCustomerProfile = Effect.fn(
  function* (
    input: CustomerProfileInput,
    referral: ProfileCompletionReferral | undefined,
    _locale: Locale
  ) {
    const user = yield* requireVerifiedSession;
    const resolution = yield* CustomerAccountResolver.pipe(
      Effect.flatMap((resolver) => resolver.resolve),
      Effect.result
    );

    if (Result.isSuccess(resolution)) {
      yield* Effect.flatMap(CustomerProfileService, (profile) =>
        profile.update(resolution.success, input)
      );
      return { status: "saved", account: resolution.success } as const;
    }

    const failure = resolution.failure;
    if (
      failure.reason === "link-required" &&
      failure.linkReason === "not-found"
    ) {
      return yield* completeNewCustomerProfile(
        user,
        input,
        referral ?? { code: undefined, prefilledCode: undefined }
      );
    }
    return yield* failure;
  },
  (effect, _input, _referral, locale) =>
    effect.pipe(
      Effect.mapError(accountActionError(locale)),
      Effect.provide(
        Layer.mergeAll(
          CustomerAuthentication.Default,
          CustomerAccountResolver.Live,
          CustomerProfileService.Live,
          ReferralService.Live,
          ReferralSignupIntentRepository.Live
        )
      )
    )
);

/**
 * Forgets the referral code this browser remembers once the customer's
 * referral is settled, whether by this completion or earlier. The completion
 * field, not the remembered code, decides which code this save records. A
 * withheld referral program neither checks nor forgets the code.
 */
const forgetUsedRememberedReferralCode = (account: LinkedCustomerAccount) =>
  readRememberedReferralCode.pipe(
    // Forgetting is best effort; an unreadable cookie keeps the code.
    Effect.orElseSucceed(() => undefined),
    Effect.flatMap((rememberedCode) =>
      isRememberedReferralCodeUsed(rememberedCode, account)
    ),
    Effect.flatMap((used) =>
      used ? Effect.promise(forgetRememberedReferralCode) : Effect.void
    ),
    Effect.when(
      Effect.flatMap(ReferralFeatureFlagService, (flag) => flag.isEnabled)
    ),
    Effect.asVoid,
    Effect.provide(ReferralService.Live)
  );

/**
 * Saves the locale preference of the verified account under the account lock.
 * The preference is also the site locale for the signed-in customer, so the
 * caller navigates to the page under the saved locale, and the proxy moves the
 * locale cookie on that page's response. The action leaves cookies alone: a
 * cookie write makes Next re-render the referring page, still under the old
 * locale, while the document navigation is leaving it. The Dotypos profile is
 * never touched.
 */
const saveLocalePreference = (accountId: CustomerAccountId, locale: Locale) =>
  saveAccountLocalePreference(accountId, locale).pipe(
    Effect.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        CustomerAccountLinkRepository.Live,
        CustomerAuthentication.Default
      )
    )
  );

const completeCustomerProfileAction = defineWorkspaceAction(
  {
    operation: "account.complete-profile",
    schema: completeCustomerProfileStandardSchema,
    logInput: false,
  },
  Effect.fn(function* (
    { referralCode, prefilledReferralCode, ...input },
    { locale }
  ) {
    const outcome = yield* saveCustomerProfile(
      input,
      { code: referralCode, prefilledCode: prefilledReferralCode },
      locale
    );
    if (outcome.status === "referral-code-unavailable") return outcome;

    yield* forgetUsedRememberedReferralCode(outcome.account);
    return outcome.status === "completed" && outcome.referral
      ? { status: "completed" as const, referral: outcome.referral }
      : { status: "completed" as const };
  }, Effect.provide(ReferralFeatureFlagRequest))
);

const updateCustomerProfileAction = defineWorkspaceAction(
  {
    operation: "account.update-profile",
    schema: updateCustomerProfileStandardSchema,
    logInput: false,
  },
  (input, { locale }) =>
    Effect.as(saveCustomerProfile(input, undefined, locale), {
      status: "updated" as const,
    }).pipe(Effect.provide(ReferralFeatureFlagRequest))
);

const acknowledgeSignupReferralNoticeSchema = Schema.toStandardSchemaV1(
  Schema.Struct({}),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

/**
 * Hides the settled outcome of the referral code entered at profile
 * completion. The notice shows from stored state until this runs. A withheld
 * referral program shows no notice and leaves the stored outcome untouched.
 */
const acknowledgeSignupReferralNoticeAction = defineWorkspaceAction(
  {
    operation: "account.acknowledge-signup-referral",
    schema: acknowledgeSignupReferralNoticeSchema,
    logInput: false,
  },
  (_input, { locale }) =>
    Effect.andThen(
      requireReferralsEnabled(locale),
      CustomerAccountResolver.pipe(
        Effect.flatMap((resolver) => resolver.resolve),
        Effect.flatMap((account) =>
          acknowledgeSignupReferral(account).pipe(
            Effect.mapError(
              mapCustomerAccountFailure("referral.signup-acknowledge")
            )
          )
        ),
        Effect.as({ status: "acknowledged" as const }),
        Effect.mapError(accountActionError(locale)),
        Effect.provide(
          Layer.mergeAll(
            CustomerAccountResolver.Live,
            ReferralSignupIntentRepository.Live
          )
        )
      )
    ).pipe(Effect.provide(ReferralFeatureFlagRequest))
);

const updateLocalePreferenceAction = defineWorkspaceAction(
  {
    operation: "account.update-locale-preference",
    schema: localePreferenceSchema,
    logInput: false,
  },
  (input, { locale }) =>
    Effect.flatMap(requireVerifiedSession, (user) =>
      saveLocalePreference(user.accountId, input.locale)
    ).pipe(
      Effect.mapError(accountActionError(locale)),
      Effect.provide(CustomerAuthentication.Default),
      Effect.as({ status: "saved" as const })
    )
);

export type CustomerAccountDeletionResult =
  | { readonly status: "deleted" }
  | { readonly status: "reauthentication-required" }
  | { readonly status: "failed" };

const revalidateDeletionAuthority = (locale: Locale) =>
  Effect.sync(() => {
    // The account layout covers every section's path and the deleted page.
    revalidatePath(getAccountPath(locale), "layout");
  });

/**
 * Runs account deletion exclusively through Better Auth's public delete-user
 * endpoint, so its session-freshness gate and the provider-first beforeDelete
 * hook stay the single identity-deletion path. A stale or missing session
 * asks for reauthentication; an unreadable session or a retryable provider
 * failure reports a retryable failure and keeps the durable deletion marker
 * and the account untouched.
 */
const deleteCustomerAccountAction = defineWorkspaceAction(
  {
    operation: "account.delete",
    schema: deleteCustomerAccountConfirmedSchema,
    logInput: false,
  },
  Effect.fn(function* (_input, { locale }) {
    const session = yield* requireVerifiedSession.pipe(
      Effect.provide(CustomerAuthentication.Default),
      Effect.result
    );
    if (Result.isFailure(session)) {
      const result = toDeletionSessionFailureResult(session.failure);
      yield* Effect.log("Customer account deletion did not complete").pipe(
        Effect.annotateLogs({
          code: "account.delete.session",
          reason: session.failure.reason,
          diagnostic: session.failure.diagnostic,
        }),
        Effect.when(Effect.succeed(result.status === "failed"))
      );
      return yield* revalidateDeletionAuthority(locale).pipe(Effect.as(result));
    }

    // The endpoint adapter converts every rejection into its closed result.
    const result = yield* Effect.promise(() =>
      deleteCurrentAccountThroughAuthEndpoint()
    );

    yield* revalidateDeletionAuthority(locale);

    if (result.status === "failed") {
      yield* Effect.log("Customer account deletion did not complete").pipe(
        Effect.annotateLogs({ code: result.code })
      );
      return { status: "failed" } as const;
    }
    return result;
  })
);

const toDeletionSessionFailureResult = (failure: CustomerAccountAccessError) =>
  Match.value(failure.reason).pipe(
    Match.when(
      Match.is("unauthenticated", "unverified-email", "link-required"),
      () => ({ status: "reauthentication-required" }) as const
    ),
    Match.when(
      Match.is("not-configured", "unavailable"),
      () => ({ status: "failed" }) as const
    ),
    Match.exhaustive
  );

const aresLookupStandardSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ ico: Schema.String }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

export type AresBusinessLookupResult =
  | {
      readonly status: "found";
      readonly company: AresBusinessBillingDraft;
    }
  | { readonly status: "invalid-ico"; readonly message: string }
  | { readonly status: "not-found"; readonly message: string }
  | { readonly status: "unavailable"; readonly message: string };

const aresLookupFailureResult = (
  failure: AresLookupFailure,
  locale: Locale
): AresBusinessLookupResult =>
  Match.value(failure).pipe(
    Match.discriminatorsExhaustive("reason")({
      InvalidIco: () => ({
        status: "invalid-ico" as const,
        message: m.accountAresLookupInvalidIco({}, { locale }),
      }),
      NotFound: () => ({
        status: "not-found" as const,
        message: m.accountAresLookupNotFound({}, { locale }),
      }),
      Unavailable: () => ({
        status: "unavailable" as const,
        message: m.accountAresLookupUnavailable({}, { locale }),
      }),
    })
  );

const lookupAresBusinessWorkflow = Effect.fn(function* (
  input: { ico: string },
  locale: Locale
) {
  const user = yield* requireVerifiedSession;
  if (user.deletionRequested) {
    // The read-only lookup never resolves the customer account: resolution
    // may reactivate and claim an expired provider profile, which is a
    // provider write, and it rejects accounts whose profile link is not
    // settled. The durable deletion marker on the verified session is the
    // same authority the activity guard consults, checked here explicitly.
    return yield* new CustomerAccountAccessError({
      reason: "link-required",
      linkReason: "deletion-requested",
    });
  }

  const ares = yield* AresLookupService;
  const lookup = yield* Effect.result(ares.lookup(input.ico.trim()));

  if (Result.isFailure(lookup)) {
    return aresLookupFailureResult(lookup.failure, locale);
  }
  return {
    status: "found" as const,
    company: toAresBusinessBillingDraft(lookup.success),
  };
});

/**
 * Looks up one Czech company in the public ARES registry for the business
 * billing form. Runs behind the verified session and the durable deletion
 * marker, and performs exactly one provider request per
 * invocation without any retry loop and without any customer classify,
 * reactivate, claim, create, update, or other provider write.
 */
const lookupAresBusinessAction = defineWorkspaceAction(
  {
    operation: "account.ares-lookup",
    schema: aresLookupStandardSchema,
    logInput: false,
  },
  (input, { locale }) =>
    lookupAresBusinessWorkflow(input, locale).pipe(
      Effect.mapError(accountActionError(locale)),
      Effect.provide(
        Layer.mergeAll(CustomerAuthentication.Default, AresLookupService.Live)
      )
    )
);

export const lookupAresBusiness: typeof lookupAresBusinessAction = async (
  ...args: Parameters<typeof lookupAresBusinessAction>
) => {
  "use server";
  return await lookupAresBusinessAction(...args);
};

export const completeCustomerProfile: typeof completeCustomerProfileAction =
  async (...args: Parameters<typeof completeCustomerProfileAction>) => {
    "use server";
    return await completeCustomerProfileAction(...args);
  };

export const updateCustomerProfile: typeof updateCustomerProfileAction = async (
  ...args: Parameters<typeof updateCustomerProfileAction>
) => {
  "use server";
  return await updateCustomerProfileAction(...args);
};

export const updateLocalePreference: typeof updateLocalePreferenceAction =
  async (...args: Parameters<typeof updateLocalePreferenceAction>) => {
    "use server";
    return await updateLocalePreferenceAction(...args);
  };

export const deleteCustomerAccount: typeof deleteCustomerAccountAction = async (
  ...args: Parameters<typeof deleteCustomerAccountAction>
) => {
  "use server";
  return await deleteCustomerAccountAction(...args);
};

export const acknowledgeSignupReferralNotice: typeof acknowledgeSignupReferralNoticeAction =
  async (...args: Parameters<typeof acknowledgeSignupReferralNoticeAction>) => {
    "use server";
    return await acknowledgeSignupReferralNoticeAction(...args);
  };
