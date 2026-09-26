import { loadCustomerInvoicePdf } from "@/features/account/customer-invoice-page-data.server";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly invoiceId: string }> }
) {
  const { invoiceId } = await params;
  const pdf = await loadCustomerInvoicePdf(invoiceId);
  return new Response(Uint8Array.from(pdf.bytes), {
    headers: {
      "Content-Disposition": `attachment; filename="${pdf.fileName}"`,
      "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store",
    },
  });
}
