"use server";

import { type AresLookupFailure, AresLookupService } from "@deskohub/ares";
import { Effect, Layer, Match, Result, Schema } from "effect";
import { revalidatePath } from "next/cache";
import { WorkspaceDatabase } from "@/db/database.service";
import { accountActionError } from "@/features/account/account-action-guards";
import type { AresBusinessBillingDraft } from "@/features/account/backend/ares-business-draft";
import { toAresBusinessBillingDraft } from "@/features/account/backend/ares-business-draft";
import { CustomerAccountDeletionEndpoint } from "@/features/account/backend/auth/delete-account-endpoint";
import { requestCurrentAccountDeletion } from "@/features/account/backend/current-account-deletion";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { saveAccountLocalePreference } from "@/features/account/backend/customer-locale-preference";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import {
  completeCurrentCustomerProfile,
  updateCurrentCustomerProfile,
} from "@/features/account/backend/customer-profile-saving";
import { acknowledgeCurrentSignupReferral } from "@/features/account/backend/signup-referral";
import { requireVerifiedSession } from "@/features/account/backend/verified-customer-session";
import {
  completeCustomerProfileStandardSchema,
  updateCustomerProfileStandardSchema,
} from "@/features/account/contracts";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
} from "@/features/account/customer-account";
import { getAccountPath } from "@/features/account/routes";
import type { Locale } from "@/features/i18n";
import { locales, m } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const deleteCustomerAccountConfirmedSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ confirmed: Schema.Literal(true) }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

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
 * The live capabilities of the profile saves, under the request's one
 * referral release decision.
 */
const profileSavingLayer = Layer.mergeAll(
  CustomerAuthentication.Default,
  CustomerAccountResolver.Live,
  CustomerProfileService.Live,
  ReferralService.Live,
  ReferralSignupIntentRepository.Live
);

/** The browser's remembered referral code, forgotten once settled. */
const rememberedReferralLayer = RememberedReferral.Cookies.pipe(
  Layer.provide(
    Layer.mergeAll(ReferralService.Live, CustomerAccountContactService.Live)
  )
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
  (input, { locale }) =>
    completeCurrentCustomerProfile(input).pipe(
      Effect.mapError(accountActionError(locale)),
      Effect.provide(
        Layer.mergeAll(profileSavingLayer, rememberedReferralLayer).pipe(
          Layer.provideMerge(ReferralReleaseGateRequest)
        )
      )
    )
);

const updateCustomerProfileAction = defineWorkspaceAction(
  {
    operation: "account.update-profile",
    schema: updateCustomerProfileStandardSchema,
    logInput: false,
  },
  (input, { locale }) =>
    updateCurrentCustomerProfile(input).pipe(
      Effect.mapError(accountActionError(locale)),
      Effect.provide(
        profileSavingLayer.pipe(Layer.provideMerge(ReferralReleaseGateRequest))
      )
    )
);

const acknowledgeSignupReferralNoticeSchema = Schema.toStandardSchemaV1(
  Schema.Struct({}),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

/**
 * Hides the settled outcome of the referral code entered at profile
 * completion. A withheld referral program refuses as unavailable.
 */
const acknowledgeSignupReferralNoticeAction = defineWorkspaceAction(
  {
    operation: "account.acknowledge-signup-referral",
    schema: acknowledgeSignupReferralNoticeSchema,
    logInput: false,
  },
  (_input, { locale }) =>
    acknowledgeCurrentSignupReferral().pipe(
      Effect.mapError(accountActionError(locale)),
      Effect.provide(
        Layer.mergeAll(
          CustomerAccountResolver.Live,
          ReferralSignupIntentRepository.Live,
          ReferralReleaseGateRequest
        )
      )
    )
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

export type { CustomerAccountDeletionResult } from "@/features/account/backend/current-account-deletion";

/**
 * Deletes the signed-in account through Better Auth's delete-user endpoint
 * and revalidates the account layout on every outcome, which covers every
 * section's path and the deleted page.
 */
const deleteCustomerAccountAction = defineWorkspaceAction(
  {
    operation: "account.delete",
    schema: deleteCustomerAccountConfirmedSchema,
    logInput: false,
  },
  (_input, { locale }) =>
    requestCurrentAccountDeletion.pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          revalidatePath(getAccountPath(locale), "layout");
        })
      ),
      Effect.provide(
        Layer.mergeAll(
          CustomerAuthentication.Default,
          CustomerAccountDeletionEndpoint.Default
        )
      )
    )
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
