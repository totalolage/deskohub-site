import { Schema } from "effect";
import { invoiceBuyerAddressSchema } from "@/features/accounting/billing-identity";
import { locales } from "@/features/i18n";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

const access = {
  locale: Schema.Literals(locales),
  orderId: workspaceReservationIdSchema,
  accessToken: Schema.NonEmptyString.check(Schema.isMaxLength(4096)),
};

export const postOrderInvoiceAddressFormSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ address: invoiceBuyerAddressSchema })
);

export const managePostOrderInvoiceSchema = Schema.toStandardSchemaV1(
  Schema.Union([
    Schema.Struct({
      ...access,
      operation: Schema.Literal("create"),
      address: invoiceBuyerAddressSchema,
    }),
    Schema.Struct({ ...access, operation: Schema.Literal("resend") }),
  ])
);
