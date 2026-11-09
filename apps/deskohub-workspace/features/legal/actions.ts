"use server";

import { Effect, Layer, Option, Schema } from "effect";
import { AnalyticsPersonAnonymisation } from "@/features/account/backend/analytics-person-anonymisation";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { locales } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { toConsentCookieTimestamp } from "@/shared/utils/consent-cookie";
import { AnalyticsConsentLedger } from "./backend/analytics-consent-ledger";
import {
  recordSignedInDeviceAnalyticsConsent,
  resolveSilentAnalyticsGrant,
} from "./backend/analytics-consent-mirror";
import { saveAnalyticsPreference } from "./backend/analytics-consent-preference";
import { MarketingPreferences } from "./backend/marketing-preferences.service";

// An account decision's instant as the device's consent cookie takes it, or
// null without one.
const consentCookieTimestampOrNull = Option.match({
  onNone: () => null,
  onSome: toConsentCookieTimestamp,
});

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

const saveAction = defineWorkspaceAction(
  {
    operation: "legal.marketing-preferences.save",
    schema: saveMarketingPreferencesSchema,
    logInput: false,
  },
  (input) =>
    Effect.flatMap(MarketingPreferences, (preferences) =>
      preferences.save(input)
    ).pipe(Effect.provide(MarketingPreferences.Live))
);

export const saveMarketingPreferencesAction: typeof saveAction = async (
  ...args: Parameters<typeof saveAction>
) => {
  "use server";
  return await saveAction(...args);
};

const confirmAction = defineWorkspaceAction(
  {
    operation: "legal.marketing-preferences.confirm",
    schema: marketingManagementContextSchema,
    logInput: false,
  },
  (input) =>
    Effect.flatMap(MarketingPreferences, (preferences) =>
      preferences.confirm(input)
    ).pipe(Effect.provide(MarketingPreferences.ManagementLive))
);

export const confirmMarketingManagementAction: typeof confirmAction = async (
  ...args: Parameters<typeof confirmAction>
) => {
  "use server";
  return await confirmAction(...args);
};

const clearAction = defineWorkspaceAction(
  {
    operation: "legal.marketing-preferences.clear",
    schema: marketingManagementContextSchema,
    logInput: false,
  },
  (input) =>
    Effect.flatMap(MarketingPreferences, (preferences) =>
      preferences.clear(input)
    ).pipe(Effect.provide(MarketingPreferences.ManagementLive))
);

export const clearMarketingManagementAction: typeof clearAction = async (
  ...args: Parameters<typeof clearAction>
) => {
  "use server";
  return await clearAction(...args);
};

const deviceAnalyticsConsentSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ occasion: Schema.Literals(["hydration", "banner_save"]) }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

const recordDeviceAnalyticsConsentAction = defineWorkspaceAction(
  {
    operation: "legal.analytics-consent.record-device",
    schema: deviceAnalyticsConsentSchema,
    logInput: false,
  },
  ({ occasion }, { locale }) =>
    recordSignedInDeviceAnalyticsConsent({ occasion, locale }).pipe(
      Effect.map(consentCookieTimestampOrNull),
      Effect.provide(
        Layer.mergeAll(
          AnalyticsConsentLedger.Live,
          CustomerAuthentication.Default
        )
      )
    )
);

/**
 * Records this device's analytics consent choice on the signed-in account:
 * as a decision made now after a banner save, or as a mirror of the saved
 * choice when a signed-in session hydrates. After a hydration, the instant
 * (ISO 8601) of the account's withdrawal this device still accepts analytics
 * against, which the device takes; else null. Does nothing when signed out.
 */
export const recordDeviceAnalyticsConsent: typeof recordDeviceAnalyticsConsentAction =
  async (...args: Parameters<typeof recordDeviceAnalyticsConsentAction>) => {
    "use server";
    return await recordDeviceAnalyticsConsentAction(...args);
  };

const silentAnalyticsGrantAction = defineWorkspaceAction(
  {
    operation: "legal.analytics-consent.resolve-silent-grant",
    schema: Schema.toStandardSchemaV1(Schema.Struct({}), {
      parseOptions: { errors: "all", onExcessProperty: "error" },
    }),
    logInput: false,
  },
  () =>
    resolveSilentAnalyticsGrant().pipe(
      Effect.map(consentCookieTimestampOrNull),
      Effect.provide(
        Layer.mergeAll(
          AnalyticsConsentLedger.Live,
          CustomerAuthentication.Default
        )
      )
    )
);

/**
 * When this device holds no consent cookie and the signed-in account's
 * current decision is a grant for the current privacy notice, the instant of
 * that grant (ISO 8601), which the device takes without asking; else null.
 * Null when signed out.
 */
export const resolveSilentAnalyticsGrantForDevice: typeof silentAnalyticsGrantAction =
  async (...args: Parameters<typeof silentAnalyticsGrantAction>) => {
    "use server";
    return await silentAnalyticsGrantAction(...args);
  };

const analyticsPreferenceSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ granted: Schema.Boolean }),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

const saveAnalyticsPreferenceAction = defineWorkspaceAction(
  {
    operation: "legal.analytics-consent.save-preference",
    schema: analyticsPreferenceSchema,
    logInput: false,
  },
  ({ granted }, { locale }) =>
    saveAnalyticsPreference({ granted, locale }).pipe(
      Effect.map(
        Option.match({
          onNone: () => null,
          onSome: ({ accountId, decidedAt }) => ({
            accountId,
            decidedAt: toConsentCookieTimestamp(decidedAt),
          }),
        })
      ),
      Effect.provide(
        Layer.mergeAll(
          AnalyticsConsentLedger.Live,
          AnalyticsPersonAnonymisation.Live,
          CustomerAuthentication.Default
        )
      )
    )
);

/**
 * Records the signed-in account's analytics preference from account
 * preferences as its decision now; turning it off also requests the
 * anonymisation of the account's PostHog person. Returns the account the
 * decision was recorded for and its instant (ISO 8601), which this device's
 * consent cookie takes; null when signed out, which records nothing.
 */
export const saveAccountAnalyticsPreference: typeof saveAnalyticsPreferenceAction =
  async (...args: Parameters<typeof saveAnalyticsPreferenceAction>) => {
    "use server";
    return await saveAnalyticsPreferenceAction(...args);
  };
