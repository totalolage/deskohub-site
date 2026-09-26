import { loadCustomerInvoiceCsv } from "@/features/account/customer-invoice-page-data.server";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly locale: string }> }
) {
  const { locale } = await params;
  const csv = await loadCustomerInvoiceCsv(locale);
  return new Response(csv.content, {
    headers: {
      "Content-Disposition": `attachment; filename="${csv.fileName}"`,
      "Content-Type": `text/csv; charset=utf-8`,
      "Cache-Control": "private, no-store",
    },
  });
}
