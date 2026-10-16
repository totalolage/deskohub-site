import { FilePlus2 } from "lucide-react";
import { Suspense } from "react";
import { InvoiceAdministrationTable } from "@/features/accounting/admin/invoice-table";
import {
  type InvoiceAdministrationSearchParams,
  loadInvoiceAdministrationList,
} from "@/features/accounting/admin/page-data.server";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationPage,
  AdministrationPageHeader,
  AdministrationTableCount,
  AdministrationTableToolbar,
  EmptyState,
  Pagination,
} from "@/features/administration/components";
import { AdministrationCollectionLoading } from "@/features/administration/loading";
import { Button } from "@/shared/components/ui/button";

export default function InvoiceAdministrationPage({
  searchParams,
}: {
  readonly searchParams: InvoiceAdministrationSearchParams;
}) {
  const data = loadInvoiceAdministrationList(searchParams);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={
          <Button asChild>
            <Link href="/admin/invoices/new">
              <FilePlus2 aria-hidden className="size-4" /> New invoice
            </Link>
          </Button>
        }
        description="Issued order and ad-hoc invoices, their provenance, and email delivery state."
        eyebrow="Accounting"
        title="Invoices"
      />
      <Suspense fallback={null}>
        <InvoiceToolbar data={data} />
      </Suspense>
      <Suspense
        fallback={
          <AdministrationCollectionLoading columns={8} label="invoices" />
        }
      >
        <InvoiceCollection data={data} />
      </Suspense>
    </AdministrationPage>
  );
}

type InvoiceData = Awaited<ReturnType<typeof loadInvoiceAdministrationList>>;
async function InvoiceToolbar({
  data,
}: {
  readonly data: Promise<InvoiceData>;
}) {
  return (
    <AdministrationTableToolbar
      count={
        <AdministrationTableCount
          count={(await data).items.total}
          itemLabel="invoice"
        />
      }
      itemLabel="invoice"
    />
  );
}
async function InvoiceCollection({
  data,
}: {
  readonly data: Promise<InvoiceData>;
}) {
  const result = await data;
  if (result.items.items.length === 0) {
    return <EmptyState message="No invoices have been issued yet." />;
  }
  return (
    <>
      <InvoiceAdministrationTable
        items={result.items.items}
        query={result.query}
      />
      <Pagination
        basePath="/admin/invoices"
        page={result.items.page}
        pageCount={result.items.pageCount}
        params={{ sort: result.query.sort, direction: result.query.direction }}
      />
    </>
  );
}
