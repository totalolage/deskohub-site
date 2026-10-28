import { AdministrationReservationSortDirection } from "@deskohub/workspace-admin-api";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
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

/**
 * A customer's current marketing consent: an active grant, a withdrawn grant,
 * or no grant ever recorded.
 */
export const AdministrationCustomerMarketingConsentState = Schema.Literals([
  "granted",
  "withdrawn",
  "never",
]);
export type AdministrationCustomerMarketingConsentState =
  typeof AdministrationCustomerMarketingConsentState.Type;

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
      AdministrationCustomerMarketingConsentState
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
    marketingConsent: optionalFilterField(
      AdministrationCustomerMarketingConsentState
    ),
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
