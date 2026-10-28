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
import {
  getAdministrationOperationFilters,
  getAdministrationPaymentDateTimeBounds,
  nexiOperationChannels,
  nexiOperationTypes,
} from "./payment-administration-filters";

const operationListParams = defineAdministrationListQuery({
  path: administrationHref("/[locale]/admin/operations"),
  params: Schema.Struct({
    channel: optionalListParam(Schema.String),
    from: optionalListParam(Schema.String),
    operationType: optionalListParam(Schema.String),
    to: optionalListParam(Schema.String),
  }),
  normalize: ({ channel, from, operationType, to }) => ({
    ...getAdministrationPaymentDateTimeBounds(from, to),
    ...getAdministrationOperationFilters({ channel, operationType }),
  }),
});

const operationFilterFormSchema = getFilterFormSchema(
  Schema.Struct({
    from: optionalFilterField(calendarDateFilterField),
    to: optionalFilterField(calendarDateFilterField),
    channel: optionalFilterField(Schema.Literals(nexiOperationChannels)),
    operationType: optionalFilterField(Schema.Literals(nexiOperationTypes)),
  })
);

/** The dates, Nexi bounds and provider filters of the operation list. */
export type OperationListQuery = ReturnType<typeof operationListParams.parse>;

/**
 * The Nexi operation list's URL query: a date range, the last week unless
 * the operator picks another, and an optional channel and operation type,
 * which read case-insensitively like the CLI's.
 */
export const operationListQuery = {
  ...operationListParams,
  formSchema: operationFilterFormSchema,
  formValues: (
    query: OperationListQuery
  ): StandardSchemaV1.InferInput<typeof operationFilterFormSchema> => ({
    from: query.from,
    to: query.to,
    channel: query.channel ?? "",
    operationType: query.operationType ?? "",
  }),
};
