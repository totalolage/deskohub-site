import { DotyposCustomerIdSchema } from "@deskohub/dotypos/types";
import {
  AdministrationReservationFamily,
  AdministrationReservationSort,
  AdministrationReservationSortDirection,
  AdministrationReservationStatusFilter,
} from "@deskohub/workspace-admin-api";
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
import { getAdministrationReservationListDateRange } from "./reservation-date-range";

const reservationListParams = defineAdministrationListQuery({
  path: administrationHref("/[locale]/admin/reservations"),
  exportPath: administrationHref("/[locale]/admin/reservations/export"),
  params: Schema.Struct({
    customerId: optionalListParam(DotyposCustomerIdSchema),
    // A single start date, from links that predate `from` and `to`.
    date: optionalListParam(Schema.String),
    direction: listParamWithDefault(
      AdministrationReservationSortDirection,
      "desc"
    ),
    from: optionalListParam(Schema.String),
    page: listPageParam,
    sort: listParamWithDefault(AdministrationReservationSort, "created"),
    status: optionalListParam(AdministrationReservationStatusFilter),
    to: optionalListParam(Schema.String),
    type: optionalListParam(AdministrationReservationFamily),
  }),
  normalize: ({ date, from, to, ...params }) => ({
    ...params,
    ...getAdministrationReservationListDateRange({
      customerId: params.customerId,
      date,
      from,
      status: params.status,
      to,
    }),
  }),
});

const reservationFilterFormSchema = getFilterFormSchema(
  Schema.Struct({
    status: optionalFilterField(AdministrationReservationStatusFilter),
    type: optionalFilterField(AdministrationReservationFamily),
    from: optionalFilterField(calendarDateFilterField),
    to: optionalFilterField(calendarDateFilterField),
    customerId: Schema.optional(Schema.String),
    sort: AdministrationReservationSort,
    direction: AdministrationReservationSortDirection,
  })
);

/** The filters, order and page of the operator's reservation list. */
export type ReservationListQuery = ReturnType<
  typeof reservationListParams.parse
>;

/**
 * The reservation list's URL query. Without a date range the list starts on
 * January 1 of the current Workspace year, except for a single customer's
 * list and the refund queue (`getAdministrationReservationListDateRange`).
 */
export const reservationListQuery = {
  ...reservationListParams,
  formSchema: reservationFilterFormSchema,
  formValues: (
    query: ReservationListQuery
  ): StandardSchemaV1.InferInput<typeof reservationFilterFormSchema> => ({
    status: query.status ?? "",
    type: query.type ?? "",
    from: query.from ?? "",
    to: query.to ?? "",
    customerId: query.customerId,
    sort: query.sort,
    direction: query.direction,
  }),
};
