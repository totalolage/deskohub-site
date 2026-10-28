import { AdministrationReservationSortDirection } from "@deskohub/workspace-admin-api";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Option, Schema } from "effect";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { parsePlainDate } from "@/shared/utils/temporal";
import { administrationHref } from "./administration-href";
import {
  calendarDateFilterField,
  defineAdministrationListQuery,
  getFilterFormSchema,
  listPageParam,
  listParamWithDefault,
  optionalListParam,
} from "./list-query";

const AdministrationBookingSort = Schema.Literals(["booking", "status"]);

const bookingListParams = defineAdministrationListQuery({
  path: administrationHref("/[locale]/admin/bookings"),
  params: Schema.Struct({
    date: optionalListParam(Schema.String),
    direction: listParamWithDefault(
      AdministrationReservationSortDirection,
      "asc"
    ),
    page: listPageParam,
    sort: listParamWithDefault(AdministrationBookingSort, "booking"),
  }),
  sortLinkOrder: "afterFilters",
  normalize: ({ date, ...params }) => ({
    ...params,
    date: Option.fromNullishOr(date)
      .pipe(
        Option.flatMap(parsePlainDate),
        Option.getOrElse(() => getCurrentWorkspaceDate())
      )
      .toString(),
  }),
});

const bookingFilterFormSchema = getFilterFormSchema(
  Schema.Struct({
    date: calendarDateFilterField,
    sort: AdministrationBookingSort,
    direction: AdministrationReservationSortDirection,
  })
);

/** The day, order and page of the operator's table booking list. */
export type BookingListQuery = ReturnType<typeof bookingListParams.parse>;

/**
 * The table booking list's URL query: one Workspace day, today unless the
 * operator picks another, in booking order.
 */
export const bookingListQuery = {
  ...bookingListParams,
  formSchema: bookingFilterFormSchema,
  formValues: (
    query: BookingListQuery
  ): StandardSchemaV1.InferInput<typeof bookingFilterFormSchema> => ({
    date: query.date,
    sort: query.sort,
    direction: query.direction,
  }),
};
