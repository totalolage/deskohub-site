import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import { administrationHref } from "./administration-href";
import {
  calendarDateFilterField,
  defineAdministrationListQuery,
  getFilterFormSchema,
  optionalFilterField,
  optionalListParam,
} from "./list-query";
import { getAdministrationOrderDateTimeBounds } from "./payment-administration-filters";

const orderListParams = defineAdministrationListQuery({
  path: administrationHref("/[locale]/admin/orders"),
  params: Schema.Struct({
    from: optionalListParam(Schema.String),
    to: optionalListParam(Schema.String),
  }),
  normalize: ({ from, to }) => getAdministrationOrderDateTimeBounds(from, to),
});

const orderFilterFormSchema = getFilterFormSchema(
  Schema.Struct({
    from: optionalFilterField(calendarDateFilterField),
    to: optionalFilterField(calendarDateFilterField),
  })
);

/** The Workspace dates and Nexi bounds of the operator's order list. */
export type OrderListQuery = ReturnType<typeof orderListParams.parse>;

/**
 * The Nexi order list's URL query: a date range of at most one month, the
 * last week unless the operator picks another.
 */
export const orderListQuery = {
  ...orderListParams,
  formSchema: orderFilterFormSchema,
  formValues: ({
    from,
    to,
  }: OrderListQuery): StandardSchemaV1.InferInput<
    typeof orderFilterFormSchema
  > => ({ from, to }),
};
