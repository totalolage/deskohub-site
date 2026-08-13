import { Option, Schema } from "effect";
import { connection } from "next/server";
import { PostOrderInvoicePage } from "@/features/accounting/components/post-order-invoice-page";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";

const decodeSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    state: Schema.optional(
      Schema.Literals(["create", "created", "issued", "unavailable"])
    ),
    deliveryFailed: Schema.optional(Schema.Literal("true")),
  })
);

export default async function PostOrderInvoicePreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  await connection();
  const params = Option.getOrElse(
    decodeSearchParams(await searchParams),
    () => ({ state: undefined, deliveryFailed: undefined })
  );

  return runWithRequestLocale((locale) => (
    <PostOrderInvoicePage
      accessToken="synthetic-preview-capability"
      initialDeliveryFailed={params.deliveryFailed === "true"}
      initialState={params.state ?? "create"}
      locale={locale}
      orderId={"synthetic-preview-reservation" as never}
    />
  ));
}
