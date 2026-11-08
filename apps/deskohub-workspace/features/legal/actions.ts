"use server";

import { Effect, Layer, Option, Schema } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { locales } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { AnalyticsConsentLedger } from "./backend/analytics-consent-ledger";
import {
  recordSignedInDeviceAnalyticsConsent,
  resolveSilentAnalyticsGrant,
} from "./backend/analytics-consent-mirror";
import { MarketingPreferences } from "./backend/marketing-preferences.service";

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
 * choice when a signed-in session hydrates. Does nothing when signed out.
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
      Effect.map(
        Option.match({
          onNone: () => null,
          // Truncated to the millisecond the consent cookie holds, so the
          // device's copy is never newer than the grant it copies.
          onSome: (grantedAt) =>
            grantedAt
              .round({ smallestUnit: "millisecond", roundingMode: "trunc" })
              .toString(),
        })
      ),
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
