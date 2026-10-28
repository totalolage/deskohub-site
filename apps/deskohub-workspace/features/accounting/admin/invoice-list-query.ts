import {
  AdministrationInvoiceSort,
  AdministrationReservationSortDirection,
} from "@deskohub/workspace-admin-api";
import { Schema, SchemaTransformation } from "effect";
import { administrationHref } from "@/features/administration/administration-href";
import {
  defineAdministrationListQuery,
  optionalListParam,
} from "@/features/administration/list-query";

/**
 * The invoice list's URL query. Without an order or page the service shows
 * its own default, so the query leaves them out, as it does a param the URL
 * repeats.
 */
export const invoiceListQuery = defineAdministrationListQuery({
  path: administrationHref("/[locale]/admin/invoices"),
  params: Schema.Struct({
    sort: optionalListParam(AdministrationInvoiceSort),
    direction: optionalListParam(AdministrationReservationSortDirection),
    page: optionalListParam(
      Schema.String.check(Schema.isPattern(/^\d+$/)).pipe(
        Schema.decodeTo(
          Schema.Number.check(Schema.isGreaterThanOrEqualTo(1)),
          SchemaTransformation.transform({ decode: Number, encode: String })
        )
      )
    ),
  }),
  repeatedParams: "absent",
  normalize: (params) => params,
});

/** The order and page of the operator's invoice list. */
export type InvoiceListQuery = ReturnType<typeof invoiceListQuery.parse>;
