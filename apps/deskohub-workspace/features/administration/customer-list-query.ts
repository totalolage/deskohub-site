import { AdministrationReservationSortDirection } from "@deskohub/workspace-admin-api";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema, SchemaTransformation } from "effect";
import type { MarketingConsentStatus } from "@/features/legal/marketing-consent-status";
import { administrationHref } from "./administration-href";
import {
  calendarDateFilterField,
  defineAdministrationListQuery,
  getFilterFormSchema,
  listPageParam,
  listParamWithDefault,
  optionalFilterField,
  optionalListParam,
} from "./list-query";
import { getAdministrationReservationDateRange } from "./reservation-date-range";

/** The marketing consent states the list filters by, in the filter's order. */
const marketingConsentStatuses = [
  "active",
  "withdrawn",
  "absent",
] as const satisfies readonly MarketingConsentStatus[];

const MarketingConsentStatusField = Schema.Literals(marketingConsentStatuses);

/**
 * The filter's values from before the list named the states after the consent
 * ledger. A link made then still filters the same customers.
 */
const LegacyMarketingConsentStatusParam = Schema.Literals([
  "granted",
  "never",
]).pipe(
  Schema.decodeTo(
    Schema.Literals(["active", "absent"]),
    SchemaTransformation.transform({
      decode: (value) => (value === "granted" ? "active" : "absent"),
      encode: (status) => (status === "active" ? "granted" : "never"),
    })
  )
);

const AdministrationCustomerSort = Schema.Literals([
  "activity",
  "reservations",
]);

const customerListParams = defineAdministrationListQuery({
  path: administrationHref("/[locale]/admin/customers"),
  exportPath: administrationHref("/[locale]/admin/customers/export"),
  params: Schema.Struct({
    direction: listParamWithDefault(
      AdministrationReservationSortDirection,
      "desc"
    ),
    from: optionalListParam(Schema.String),
    marketingConsent: optionalListParam(
      Schema.Union([
        MarketingConsentStatusField,
        LegacyMarketingConsentStatusParam,
      ])
    ),
    page: listPageParam,
    sort: listParamWithDefault(AdministrationCustomerSort, "activity"),
    to: optionalListParam(Schema.String),
  }),
  normalize: ({ from, to, ...params }) => ({
    ...params,
    ...getAdministrationReservationDateRange({ from, to }),
  }),
});

const customerFilterFormSchema = getFilterFormSchema(
  Schema.Struct({
    from: optionalFilterField(calendarDateFilterField),
    to: optionalFilterField(calendarDateFilterField),
    marketingConsent: optionalFilterField(MarketingConsentStatusField),
    sort: AdministrationCustomerSort,
    direction: AdministrationReservationSortDirection,
  })
);

/** The filters, order and page of the operator's customer list. */
export type CustomerListQuery = ReturnType<typeof customerListParams.parse>;

/**
 * The customer list's URL query. The list has no default date range: without
 * `from` or `to` it covers every customer, by latest activity first.
 */
export const customerListQuery = {
  ...customerListParams,
  /** The consent states the list can filter by, in the filter's order. */
  marketingConsentStates: marketingConsentStatuses,
  formSchema: customerFilterFormSchema,
  formValues: (
    query: CustomerListQuery
  ): StandardSchemaV1.InferInput<typeof customerFilterFormSchema> => ({
    from: query.from ?? "",
    to: query.to ?? "",
    marketingConsent: query.marketingConsent ?? "",
    sort: query.sort,
    direction: query.direction,
  }),
};
