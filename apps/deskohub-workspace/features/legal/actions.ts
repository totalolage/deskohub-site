"use server";

import { Effect, Schema } from "effect";
import { locales } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
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
